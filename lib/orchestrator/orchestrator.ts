import { ChatGateway, ChatMessage } from '../gateway';
import { SafetyClassifier, RuleLayer } from '../safety-classifier/classifier';
import { crisisResponse } from '../crisis-response';
import { EmotionRecognizer } from '../emotion-recognition';
import { EmpathyDecisionEngine, OutputFilter } from '../empathy-decision';
import { IntentClassifier, IntentRouter } from '../intent';
import { communicationGuidance } from '../intent/router';
import { requestedGame } from '../tarot/reflection-games';
import { validReflection, reflectionPrompt } from '../tarot/reflection-session';
import { TarotInteractionManager } from '../tarot/interaction';
import { LocalKnowledge, localEmotions } from '../local-knowledge';
import { buildEmotionRag, EmotionRagContext, emotionRagPrompt } from '../emotion-rag';
import { emptyProfile, inferTurnAnalysis, MemoryProfile, memoryCommand, memoryPrompt, prepareMemory, retrieveMemories } from '../memory';
import { ConversationStateMachine } from './state-machine';
import { JourneyStageTracker } from './journey-tracker';
import { retrievalRequest, validSemanticScores, boundedHistory } from '../context/retrieval';
import { continuityView, continuityPrompt } from '../context/continuity';
import { focusedTask } from '../memory/follow-up';
import { updateExperiments } from '../memory/experiments';
import { applyJourneyPolicy } from './journey-policy';
import { sessionHealth } from './session-health';
import { advanceAffect, affectView, affectPrompt } from '../affect/engine';
import {
  SessionState, StateDecision, EmotionState, SafetyResult,
  OrchestratorInput, OrchestratorOutput, OrchestratorConfig, DEFAULT_ORCHESTRATOR_CONFIG,
} from './types';

/** The local runtime persists returned state; failed/cancelled turns never commit partial history. */
export class ConversationOrchestrator {
  private config: OrchestratorConfig;
  private stateMachine: ConversationStateMachine;
  private journeyTracker = new JourneyStageTracker();
  private gateway: ChatGateway;
  private emotionRecognizer: EmotionRecognizer;
  private outputFilter = new OutputFilter();
  private empathyEngine = new EmpathyDecisionEngine();
  private reflectionManager = new TarotInteractionManager();
  private extractor: ChatGateway;
  private intentClassifier: IntentClassifier;
  private env: Record<string, string>;
  private knowledge: LocalKnowledge;
  private sessionStates = new Map<string, SessionState>();
  private memoryProfiles = new Map<string, MemoryProfile>();

  constructor(env: Record<string, string>, config: Partial<OrchestratorConfig> = {}) {
    this.env = env;
    this.knowledge = new LocalKnowledge(env);
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
    this.stateMachine = new ConversationStateMachine(this.config);
    this.gateway = new ChatGateway(env);
    this.extractor = new ChatGateway({ ...env, AI_TIMEOUT_MS: '10000' });
    this.emotionRecognizer = new EmotionRecognizer();
    this.intentClassifier = new IntentClassifier();
  }

  async processTurn(input: OrchestratorInput): Promise<OrchestratorOutput> {
    const started = Date.now();
    const { sessionId, userId, userInput, signal } = input;
    if (input.backend !== undefined && input.backend !== 'cloud') throw new Error('本地生成已停用；本地模型只提供情绪 RAG，回复使用云端模型。');
    signal?.throwIfAborted();
    const existing = input.sessionState || this.getOrCreateSessionState(userId, sessionId);
    if (existing.userId !== userId || existing.sessionId !== sessionId) throw new Error('会话身份不匹配。');
    const state: SessionState = structuredClone(existing);
    if(state.currentState==='SESSION_CLOSE') {state.currentState='EMPATHY_PHASE';state.currentSubState=undefined;state.healthCheckpoint={at:new Date().toISOString(),turnCount:state.turnCount};}
    delete state.explicitMemories;
    for(const key of ['memoryOperationsPending','kvCacheValid']) delete (state as unknown as Record<string,unknown>)[key];
    const originalMemory = input.memoryProfile || this.memoryProfiles.get(userId) || emptyProfile(userId);
    if (originalMemory.owner !== userId) throw new Error('记忆身份不匹配。');
    let memory = structuredClone(originalMemory);
    const historyFor = (profile: MemoryProfile) => boundedHistory(state.recentHistory,profile.contextEpoch);
    if (state.memoryContextEpoch !== memory.contextEpoch) { delete state.focusMemoryId; delete state.reflection; }
    state.reflection = validReflection(state.reflection, memory.contextEpoch);
    const command = memoryCommand(userInput), game = requestedGame(userInput);
    const gameReply = !game && state.reflection ? this.reflectionManager.select(state.reflection, userInput) : undefined;
    const origin = { sessionId, turnId:String(state.turnCount + 1), now:Date.now() };
    const earlyMemory = game || gameReply ? memory : prepareMemory(memory, userInput, origin, [], state.focusMemoryId).profile;
    const retrieval = retrievalRequest(userInput, earlyMemory, historyFor(earlyMemory));
    const timings: Record<string, number> = {};
    const timed = async <T>(name:string, work:Promise<T>):Promise<T> => {
      const at = performance.now(); try { return await work; } finally { timings[name] = Math.round(performance.now()-at); }
    };

    // Rule-level crisis checks must run before any external network request.
    const rule = new RuleLayer().classify(userInput);
    const continuingSafety = state.currentState === 'SAFETY_PROTOCOL' && !/我现在(很)?安全|我已经安全|有人陪着我|已经联系.*(家人|朋友|急救)|I am safe now|I'm safe now/i.test(userInput);
    const quickCrisis = rule.preliminaryLevel === 'L2' || continuingSafety;
    const deterministic = !!(command || game || gameReply);
    const classifier = new SafetyClassifier(this.env, { enableModelLayer: !quickCrisis && !deterministic });
    const context = historyFor(memory).map(t => ({ role: t.role, content: t.content, timestamp: t.timestamp,
      emotionValence: t.emotion?.valence }));
    const [classification, knowledge, analysis] = await Promise.all([
      timed('safetyMs', classifier.classify(userInput, sessionId, context, signal)),
      timed('retrievalMs', quickCrisis || deterministic ? Promise.resolve(undefined) : this.knowledge.analyze(userInput, signal, retrieval)),
      timed('extractionMs', !quickCrisis && !deterministic && memory.settings.capture
        ? inferTurnAnalysis(this.extractor, userInput, signal, memory.settings.recall ? memory.entries : [],{history:historyFor(memory),affect:memory.affect?.enabled!==false}) : Promise.resolve({candidates:[],experiments:[],intent:undefined,affect:[]})),
    ]);
    timings.preparationMs = Date.now()-started;
    const localEmotion = knowledge && knowledge.confidence >= .55 ? localEmotions[knowledge.emotion] : undefined;
    const recognized = localEmotion ? {
      ...this.emotionRecognizer.recognizeLocally(userInput), primaryEmotion: { ...this.emotionRecognizer.recognizeLocally(userInput).primaryEmotion, name: localEmotion.name },
      valence: localEmotion.valence, arousal: localEmotion.arousal,
    } : this.emotionRecognizer.recognizeLocally(userInput);
    signal?.throwIfAborted();
    const previous = state.emotionTrajectory.slice(-3);
    const delta = previous.length ? recognized.intensity - previous.reduce((sum, e) => sum + e.intensity, 0) / previous.length : 0;
    const emotion: EmotionState = {
      primaryEmotion: recognized.primaryEmotion.name, intensity: recognized.intensity,
      valence: recognized.valence, arousal: recognized.arousal,
      trajectory: delta > 0.15 ? 'rising' : delta < -0.15 ? 'declining' : 'stable',
      secondaryEmotions: recognized.secondaryEmotion ? [recognized.secondaryEmotion.name] : [],
      riskLevel: classification.riskLevel === 'L2' ? 'high' : classification.riskLevel === 'L1' ? 'medium' : 'low',
      timestamp: new Date().toISOString(),
    };
    const safety: SafetyResult = {
      riskLevel: emotion.riskLevel, riskType: classification.crisisSubtype,
      shouldBlock: classification.shouldBlock, evidence: classification.evidence,
    };
    // Stay in supportive safety mode until the user explicitly confirms their immediate safety.
    if (continuingSafety) {
      safety.shouldBlock = true;
      safety.riskLevel = 'high';
      emotion.riskLevel = 'high';
    }
    let decision = this.stateMachine.evaluateTransition(state, emotion, userInput, safety);
    let response: string;
    let memoryUsed = 0;
    let affectUpdates = 0;
    let quality: { score: number; warnings: string[] } | undefined;
    let rag: EmotionRagContext | undefined;
    let jointRetrieval: OrchestratorOutput['metadata']['retrieval'];
    let continuity: ReturnType<typeof continuityView> | undefined;
    let assistantAffect=affectView(memory);
    if (safety.shouldBlock) {
      decision = { nextState: 'SAFETY_PROTOCOL', empathyLevel: 'L1', shouldProgress: false,
        constraints: { empathyOnly: true, noProgression: true }, reason: '优先确认即时安全', transitionScore: 1 };
      response = crisisResponse(safety.riskType);
      // Forgetting is a data-control request and remains available in safety mode.
      if (memoryCommand(userInput) === 'forget') {
        const cleared = prepareMemory(memory, userInput, { sessionId, turnId: String(state.turnCount + 1), now: Date.now() });
        memory = cleared.profile;
        assistantAffect=affectView(memory);
        response = cleared.reply + '\n\n' + response;
      }
    } else {
      const prepared = game || gameReply ? { profile:memory,reply:undefined } : prepareMemory(memory, userInput, origin, analysis.candidates, state.focusMemoryId);
      memory = prepared.profile;
      updateExperiments(memory,analysis.experiments,userInput,origin);
      const beforeAffectRevision=memory.revision;
      assistantAffect=deterministic?affectView(memory):advanceAffect(memory,userInput,analysis.affect,origin.now);
      affectUpdates=memory.revision-beforeAffectRevision;
      if (state.reflection?.selected !== undefined && /这让我|这张|选项|联想到|it reminds|this makes/i.test(userInput)) {
        for (const record of memory.entries) if (record.evidence.some(e=>e.sessionId===origin.sessionId && e.turnId===origin.turnId)) {
          record.reflection={game:state.reflection.game,choice:state.reflection.selected};
        }
      }
      const history = historyFor(memory);
      const semantic = validSemanticScores(knowledge?.memory_hits, retrieval.candidateIds, memory.entries);
      const recalled = retrieveMemories(memory, userInput, Date.now(), 1800, semantic);
      jointRetrieval = { mode: knowledge?.memory_hits ? 'semantic-hybrid' : 'lexical-fallback', expanded:retrieval.expanded,
        candidates:retrieval.memories.length, recalled:recalled.length };
      memoryUsed = recalled.length;
      continuity = continuityView(memory);
      state.journeyStage = continuity.journey.stage;
      state.activeExperiments = continuity.tasks.filter(t => !['completed','cancelled'].includes(t.progress)).map(t => t.id);
      state.activeDirectionCards = continuity.tasks.filter(t => t.certainty === 'stated').map(t => t.id);
      state.retrievedMemories = recalled.map(e => e.id);
      state.userModelSnapshot = { revision:memory.revision,journeyStage:state.journeyStage };
      state.focusMemoryId = focusedTask(userInput,memory.settings.recall ? memory.entries : []);
      const intent = await this.intentClassifier.classify(userInput, {
        recentHistory: history.map(t => t.content), currentState: state.currentState,
        emotion: { primary: emotion.primaryEmotion, intensity: emotion.intensity, valence: emotion.valence },
      });
      if(analysis.intent && !intent.isSafetyIntent) {intent.primaryIntent=analysis.intent.intent;intent.confidence=analysis.intent.confidence;intent.recognitionLevel=2;intent.reasoning='与记忆提取合并的上下文意图分析';}
      const listen = /只想.{0,8}(?:说|倾诉|听)|(?:不要|不用|别|不想).{0,6}(?:建议|办法)|just (?:want|need).{0,30}(?:listen|vent)|(?:no|don't|do not|without).{0,12}advice/i.test(userInput);
      const completion = continuity.tasks.some(t => t.progress === 'completed' && t.updatedAt === origin.now);
      if (listen) intent.primaryIntent = 'L2.1_emotional_venting';
      else if (completion || /复盘|回顾|进展|进度|review|progress/i.test(userInput)) intent.primaryIntent = 'L2.4_review_request';
      const router = new IntentRouter(), route = router.makeRouteDecision(intent,state.currentState,emotion);
      const communication = communicationGuidance(memory.settings.recall ? memory.entries : [],userInput);
      // Explicit intent can select a phase; incidental keywords and old plans cannot push the user forward.
      if (!deterministic && decision.nextState !== 'SESSION_CLOSE') {
        const target = listen ? 'EMPATHY_PHASE' : completion || /复盘|回顾|进展|进度|review|progress/i.test(userInput) ? 'REVIEW_PHASE'
          : /(?:我该|应该|下一步).{0,8}(?:怎么|做)|给.{0,5}建议|what should I do|next step|give me advice/i.test(userInput) ? 'ACTION_PHASE' : undefined;
        if (target) decision = { ...decision,nextState:target,empathyLevel:target === 'ACTION_PHASE' ? 'L5' : target === 'REVIEW_PHASE' ? 'L4' : 'L2',
          shouldProgress:target !== 'EMPATHY_PHASE',constraints:listen ? {empathyOnly:true,noActionQuestions:true} : {},reason:'按本轮明确意图路由' };
        decision=applyJourneyPolicy(decision,state,continuity.journey,intent.primaryIntent,userInput);
      }
      if (prepared.reply) {
        response = prepared.reply;
      } else if (gameReply) {
        response = gameReply;
      } else if (decision.nextState === 'TAROT_ENTRY') {
        if ((state.tarotDraws || 0) >= 3) {
          response = '这次已经抽过三张牌了。我们可以从刚才有共鸣的部分继续聊，也可以换一个话题。';
        } else {
          state.tarotDraws = (state.tarotDraws || 0) + 1;
          const draw = this.reflectionManager.start(game || 'tarot', { userId, sessionId,
            emotion: state.turnCount ? state.currentEmotion.primaryEmotion : emotion.primaryEmotion, intensity: emotion.intensity },memory.contextEpoch);
          response = draw.response; state.reflection = draw.session;
        }
      } else if (this.gateway.mode === 'demo') {
        response = this.demoReply(userInput, { ...state, recentHistory: history }, decision);
      } else {
        rag = buildEmotionRag(userInput, knowledge, emotion, intent.primaryIntent, !!this.knowledge.url);
        const messages: ChatMessage[] = [{ role: 'system', content: [
          '你是温和、诚实的中文情感陪伴助手。结合用户具体处境回应，不做诊断，不预测命运，不声称完全理解对方。',
          '用用户使用的语言回应，支持中文与英文。一般用两到五句话简短回复。Respond in the user\'s language.',
          '不要制造排他关系或承诺现实行动。尊重用户不想继续、只想倾诉或想得到建议的意愿。一次最多提出一个问题。',
          '危险情况优先安全支持和现实求助，不提供伤害方法。用自然文字回答，不输出内部状态或分析过程。',
          `对话阶段：${decision.nextState}；交互意图：${intent.primaryIntent}；情绪估计：${emotion.primaryEmotion}。这些是启发式线索，不是诊断。`,
          `阶段约束：${JSON.stringify(decision.constraints)}。`,
          memoryPrompt(recalled, Date.now()),
          emotionRagPrompt(rag),
          continuityPrompt(continuity, userInput,recalled),
          communication.instruction,
          affectPrompt(assistantAffect),
          this.empathyEngine.guidance(decision.empathyLevel,recognized.primaryEmotion.id),
          `意图提示：${route.strategyHints.join('；')}。`,
          reflectionPrompt(validReflection(state.reflection,memory.contextEpoch)),
        ].join('\n') }, ...history.map(t => ({ role: t.role, content: t.content })), { role: 'user', content: userInput }];
        const generationStart = Date.now();
        timings.contextMs = generationStart-started-timings.preparationMs;
        if (input.onDelta) {
          response = '';
          const filter = this.outputFilter.streaming(decision.empathyLevel);
          for await (const delta of this.gateway.stream(messages, { signal, maxTokens: 800 })) {
            response += delta;
            const visible = filter.feed(delta);
            if (visible) { timings.firstDeltaMs ??= Date.now()-started; await input.onDelta(visible); }
          }
          const remaining = filter.finish();
          if (remaining) await input.onDelta(remaining);
        } else response = await this.gateway.complete(messages, { signal });
        timings.generationMs = Date.now()-generationStart;
      }
      const filtered = this.outputFilter.filterOutput(response, userInput, decision.empathyLevel, decision.shouldProgress);
      response = filtered.filteredResponse;
      quality = { score: filtered.qualityScore, warnings: filtered.warnings };
    }
    signal?.throwIfAborted();
    this.updateSessionState(state, decision, emotion, userInput, response);
    state.memoryContextEpoch = memory.contextEpoch;
    state.reflection = validReflection(state.reflection,memory.contextEpoch);
    state.recentHistory[state.recentHistory.length - 2].emotion = emotion;
    for (const turn of state.recentHistory.slice(-2)) turn.memoryEpoch = memory.contextEpoch;
    if (!input.memoryProfile) {
      this.memoryProfiles.set(userId, memory);
      if (this.memoryProfiles.size > 200) this.memoryProfiles.delete(this.memoryProfiles.keys().next().value!);
    }
    this.sessionStates.set(sessionId, state);
    // Bound the compatibility adapter cache; the local server uses its own persistent store.
    if (this.sessionStates.size > 200) this.sessionStates.delete(this.sessionStates.keys().next().value!);
    return { response, updatedState: state, updatedMemory: memory, metadata: { state: decision.nextState, subState: decision.nextSubState,
      empathyLevel: decision.empathyLevel, emotion, safetyResult: safety, memoryUsed, memoryUpdated: memory.revision - originalMemory.revision - affectUpdates,
      processingTimeMs: Date.now() - started, mode: this.gateway.mode, quality, rag, timings, retrieval:jointRetrieval,
      continuity, assistantAffect, health:sessionHealth(state,this.config), intentSource:analysis.intent?'merged-context':'local-rules', reflection: safety.shouldBlock ? undefined : state.reflection,
      sources: (rag?.evidence || []).map(({ source, source_url, license, score }) => ({ source, source_url, license, score })),
      analysisSource: localEmotion ? 'local-trained-head' : 'local-lexicon', backend: this.gateway.mode === 'live' ? 'cloud' : 'demo' } };
  }

  private demoReply(input: string, state: SessionState, decision: StateDecision): string {
    if (decision.nextState === 'SESSION_CLOSE') return '我们先聊到这里。你可以随时开始一段新的对话。';
    const quote = input.slice(0, 100);
    if (/只想.*(说|倾诉)|别.*建议|不要.*建议/.test(input)) return `你说“${quote}”。我会先听你说，不急着给建议。`;
    if (decision.nextState === 'ACTION_PHASE') return `围绕你说的“${quote}”，可以先写下最在意的一件事，再选一个今天能做的小步骤。你想从哪件事开始？`;
    const previous = state.recentHistory.filter(t => t.role === 'user').slice(-1)[0];
    const opening = previous ? `刚才你提到“${previous.content.slice(0, 45)}”，现在又说到“${quote}”。` : `你提到“${quote}”。`;
    return `${opening}\n${state.turnCount % 2 === 0 ? '我们可以先从这件事开始。现在最让你在意的部分是什么？' : '谢谢你继续说下去。你希望我先听你说，还是一起梳理一下？'}`;
  }

  // ==================== 状态管理 ====================

  /**
   * 获取或创建会话状态
   */
  private getOrCreateSessionState(userId: string, sessionId: string): SessionState {
    if (this.sessionStates.has(sessionId)) {
      return this.sessionStates.get(sessionId)!;
    }

    // 评估旅程阶段
    const journeyStage = this.journeyTracker.evaluate({}, 1);

    const now = new Date().toISOString();
    const initialState: SessionState = {
      sessionId,
      userId,
      startedAt: now,
      lastActiveAt: now,
      explicitMemories: [],
      turnCount: 0,
      currentState: 'INIT',
      stateHistory: [],
      journeyStage,
      emotionTrajectory: [],
      currentEmotion: {
        primaryEmotion: 'neutral',
        intensity: 0.3,
        valence: 0,
        arousal: 0.3,
        trajectory: 'stable',
        secondaryEmotions: [],
        riskLevel: 'low',
        timestamp: now,
      },
      consecutiveHighEmotionTurns: 0,
      consecutiveDecliningTurns: 0,
      currentEmpathyLevel: 'L2',
      empathyRounds: 0,
      empathyStrategyHistory: [],
      userModelSnapshot: {},
      retrievedMemories: [],
      recentHistory: [],
      activeDirectionCards: [],
      activeExperiments: [],
      lastStateChangeAt: now,
      warnings: [],
    };

    this.sessionStates.set(sessionId, initialState);
    return initialState;
  }

  /**
   * 更新会话状态
   */
  private updateSessionState(
    state: SessionState,
    decision: StateDecision,
    emotion: EmotionState,
    userInput: string,
    response: string
  ): SessionState {
    const now = new Date().toISOString();

    // 状态转换
    if (decision.nextState !== state.currentState) {
      state.stateHistory.push({
        fromState: state.currentState,
        fromSubState: state.currentSubState,
        toState: decision.nextState,
        toSubState: decision.nextSubState,
        timestamp: now,
        reason: decision.reason,
        emotionIntensity: emotion.intensity,
        turnCount: state.turnCount,
      });
      state.currentState = decision.nextState;
      state.currentSubState = decision.nextSubState;
      state.lastStateChangeAt = now;
    }

    state.lastActiveAt = now;
    // 更新轮次
    state.turnCount++;

    // 更新情绪轨迹
    state.emotionTrajectory.push(emotion);
    state.currentEmotion = emotion;

    // 更新连续情绪计数
    if (emotion.intensity > this.config.emotionIntensityThreshold) {
      state.consecutiveHighEmotionTurns++;
    } else {
      state.consecutiveHighEmotionTurns = 0;
    }

    if (emotion.trajectory === 'declining') {
      state.consecutiveDecliningTurns++;
    } else {
      state.consecutiveDecliningTurns = 0;
    }

    // 更新共情层级
    state.currentEmpathyLevel = decision.empathyLevel;

    // 更新共情轮次
    if (decision.nextState === 'EMPATHY_PHASE') {
      state.empathyRounds++;
    } else {
      state.empathyRounds = 0;
    }

    // 更新对话历史
    state.recentHistory.push(
      { role: 'user', content: userInput, state: decision.nextState, timestamp: now },
      { role: 'assistant', content: response, state: decision.nextState, timestamp: now }
    );

    // 保留最近 10 轮
    if (state.recentHistory.length > 20) {
      state.recentHistory = state.recentHistory.slice(-20);
    }

    state.emotionTrajectory = state.emotionTrajectory.slice(-50);
    state.stateHistory = state.stateHistory.slice(-100);
    return state;
  }


  getSessionState(sessionId: string): SessionState | undefined { return this.sessionStates.get(sessionId); }
  clearSession(sessionId: string): void { this.sessionStates.delete(sessionId); }
  endSession(sessionId: string): SessionState | null {
    const state = this.sessionStates.get(sessionId);
    if (!state) return null;
    const fromState = state.currentState;
    state.currentState = 'SESSION_CLOSE';
    state.stateHistory.push({ fromState, toState: 'SESSION_CLOSE', timestamp: new Date().toISOString(), reason: '会话结束', turnCount: state.turnCount });
    return state;
  }
  checkSessionHealth(sessionId: string, state = this.sessionStates.get(sessionId)): { status: string; message?: string } {
    return sessionHealth(state,this.config);
  }
  getJourneyGuidance(sessionId: string) {
    const state = this.sessionStates.get(sessionId);
    return state ? this.journeyTracker.getGuidance(state.journeyStage) : null;
  }
}
