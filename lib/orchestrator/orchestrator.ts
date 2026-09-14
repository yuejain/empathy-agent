/**
 * 流程编排器
 *
 * 状态机 = 导航地图（知道在哪里、能去哪里）
 * 编排器 = 驾驶员（决定怎么到那里、路上做什么）
 *
 * 每轮对话的编排流水线：
 * Phase A: 输入预处理
 * Phase B: 安全决策
 * Phase C: 状态机决策
 * Phase D: 记忆检索
 * Phase E: 上下文组装
 * Phase F: LLM 生成
 * Phase G: 输出后处理
 * Phase H: 状态更新
 * Phase I: 异步触发
 */

import {
  GlobalState, SubState, EmpathyLevel, EmotionState,
  SessionState, Turn, SafetyResult,
  OrchestratorInput, OrchestratorOutput,
  OrchestratorConfig, DEFAULT_ORCHESTRATOR_CONFIG,
  StateDecision, StateConstraints,
} from './types';
import { ConversationStateMachine } from './state-machine';
import { JourneyStageTracker } from './journey-tracker';

// 导入各模块
import { SafetyClassifier } from '../safety-classifier';
import { EmotionRecognizer } from '../emotion-recognition';
import { EmotionTracker } from '../emotion-tracker';
import { EmpathyDecisionEngine, OutputFilter } from '../empathy-decision';
import { MemoryPipeline } from '../memory/memory-pipeline';
import { TarotInteractionManager } from '../tarot';

// ==================== 编排器主类 ====================

export class ConversationOrchestrator {
  private config: OrchestratorConfig;
  private stateMachine: ConversationStateMachine;
  private journeyTracker: JourneyStageTracker;

  // 各模块实例
  private safetyClassifier: SafetyClassifier;
  private emotionRecognizer: EmotionRecognizer;
  private emotionTracker: EmotionTracker;
  private empathyEngine: EmpathyDecisionEngine;
  private outputFilter: OutputFilter;
  private tarotManager: TarotInteractionManager;

  // 会话状态缓存
  private sessionStates: Map<string, SessionState> = new Map();

  constructor(env: Record<string, string>, config: Partial<OrchestratorConfig> = {}) {
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };

    // 初始化状态机
    this.stateMachine = new ConversationStateMachine(this.config);
    this.journeyTracker = new JourneyStageTracker();

    // 初始化各模块
    this.safetyClassifier = new SafetyClassifier(env);
    this.emotionRecognizer = new EmotionRecognizer(env);
    this.emotionTracker = new EmotionTracker();
    this.empathyEngine = new EmpathyDecisionEngine();
    this.outputFilter = new OutputFilter();
    this.tarotManager = new TarotInteractionManager();
  }

  // ==================== 主编排流程 ====================

  /**
   * 处理一轮对话的完整流水线
   */
  async processTurn(input: OrchestratorInput): Promise<OrchestratorOutput> {
    const startTime = Date.now();
    const { userId, sessionId, userInput } = input;
    let sessionState = input.sessionState;

    // 确保会话状态存在
    if (!sessionState) {
      sessionState = this.getOrCreateSessionState(userId, sessionId);
    }

    // ═══════════════════════════════════════
    // Phase A: 输入预处理（可并行）
    // ═══════════════════════════════════════

    // A1: 情绪识别
    const emotionResult = await this.emotionRecognizer.recognizeEmotion(userInput);
    const rawTrend = this.emotionTracker.analyzeTrajectory(sessionId).trend;
    const emotionState: EmotionState = {
      primaryEmotion: emotionResult.primaryEmotion.name,
      intensity: emotionResult.intensity,
      valence: emotionResult.valence,
      arousal: emotionResult.arousal,
      // 归一化：emotion-tracker 使用 'escalating'，状态机使用 'rising'
      trajectory: rawTrend === 'escalating' ? 'rising' : rawTrend,
      secondaryEmotions: emotionResult.secondaryEmotion ? [emotionResult.secondaryEmotion.name] : [],
      riskLevel: emotionResult.intensity > 0.8 && emotionResult.valence < -0.7 ? 'high' :
                 emotionResult.intensity > 0.5 && emotionResult.valence < -0.3 ? 'medium' : 'low',
      timestamp: new Date().toISOString(),
    };

    // A2: 记录情绪
    this.emotionTracker.recordEmotion(
      sessionId, userInput,
      emotionResult.primaryEmotion,
      emotionResult.intensity,
      emotionResult.valence,
      emotionResult.arousal,
      emotionResult.dominance
    );

    // ═══════════════════════════════════════
    // Phase B: 安全决策（阻塞式）
    // ═══════════════════════════════════════

    const safetyResult = await this.performSafetyCheck(
      userInput, sessionState, emotionState
    );

    if (safetyResult.shouldBlock) {
      return this.handleSafetyBlock(safetyResult, sessionState, emotionState, startTime);
    }

    // ═══════════════════════════════════════
    // Phase C: 状态机决策
    // ═══════════════════════════════════════

    const stateDecision = this.stateMachine.evaluateTransition(
      sessionState, emotionState, userInput, safetyResult
    );

    // ═══════════════════════════════════════
    // Phase D: 构建上下文指令
    // ═══════════════════════════════════════

    const empathyInstruction = this.buildEmpathyInstruction(
      stateDecision, emotionState, sessionState
    );

    const stateConstraints = this.stateMachine.getStateConstraints(
      stateDecision.nextState
    );

    // ═══════════════════════════════════════
    // Phase E: 生成响应
    // ═══════════════════════════════════════

    const response = await this.generateResponse(
      userInput, sessionState, stateDecision,
      empathyInstruction, stateConstraints, emotionState
    );

    // ═══════════════════════════════════════
    // Phase F: 输出过滤
    // ═══════════════════════════════════════

    const shouldProgress = stateDecision.shouldProgress;
    const filterResult = this.outputFilter.filterOutput(
      response, userInput, stateDecision.empathyLevel, shouldProgress
    );

    // ═══════════════════════════════════════
    // Phase G: 状态更新
    // ═══════════════════════════════════════

    sessionState = this.updateSessionState(
      sessionState, stateDecision, emotionState,
      userInput, filterResult.filteredResponse
    );

    // ═══════════════════════════════════════
    // Phase H: 缓存状态
    // ═══════════════════════════════════════

    this.sessionStates.set(sessionId, sessionState);

    const processingTime = Date.now() - startTime;

    return {
      response: filterResult.filteredResponse,
      updatedState: sessionState,
      metadata: {
        state: stateDecision.nextState,
        subState: stateDecision.nextSubState,
        empathyLevel: stateDecision.empathyLevel,
        emotion: emotionState,
        safetyResult,
        memoryUsed: 0,
        processingTimeMs: processingTime,
      },
    };
  }

  // ==================== 安全检查 ====================

  private async performSafetyCheck(
    userInput: string,
    sessionState: SessionState,
    emotion: EmotionState
  ): Promise<SafetyResult> {
    // 快速安全信号检测
    const quickSignals = ['想死', '不想活', '自杀', '割腕', '跳楼', '结束生命'];
    const hasQuickSignal = quickSignals.some(s => userInput.includes(s));

    if (hasQuickSignal) {
      return {
        riskLevel: 'high',
        riskType: 'suicide_self_harm',
        evidence: ['检测到自杀相关关键词'],
        shouldBlock: true,
        safetyResponse: '我听到你说的话，这听起来你正在经历非常大的痛苦。我真的很关心你的安全。',
      };
    }

    // 使用安全分类器
    const classification = await this.safetyClassifier.classify(
      userInput, sessionState.sessionId, sessionState.recentHistory
    );

    return {
      riskLevel: classification.riskLevel === 'L2' ? 'high' :
                 classification.riskLevel === 'L1' ? 'medium' : 'low',
      riskType: classification.crisisSubtype !== 'none' ? classification.crisisSubtype : undefined,
      evidence: classification.evidence,
      shouldBlock: classification.shouldBlock,
      safetyResponse: classification.suggestedResponse,
    };
  }

  /**
   * 处理安全阻断
   */
  private handleSafetyBlock(
    safetyResult: SafetyResult,
    sessionState: SessionState,
    emotion: EmotionState,
    startTime: number
  ): OrchestratorOutput {
    // 更新状态为安全协议
    sessionState.currentState = 'SAFETY_PROTOCOL';
    sessionState.stateHistory.push({
      fromState: sessionState.currentState,
      toState: 'SAFETY_PROTOCOL',
      timestamp: new Date().toISOString(),
      reason: '安全信号触发',
      emotionIntensity: emotion.intensity,
      turnCount: sessionState.turnCount,
    });

    this.sessionStates.set(sessionState.sessionId, sessionState);

    return {
      response: safetyResult.safetyResponse || '我注意到你可能正在经历困难。请记住，你并不孤单，有人在乎你。',
      updatedState: sessionState,
      metadata: {
        state: 'SAFETY_PROTOCOL',
        empathyLevel: 'L1',
        emotion,
        safetyResult,
        memoryUsed: 0,
        processingTimeMs: Date.now() - startTime,
      },
    };
  }

  // ==================== 响应生成 ====================

  private async generateResponse(
    userInput: string,
    sessionState: SessionState,
    stateDecision: StateDecision,
    empathyInstruction: string,
    constraints: StateConstraints,
    emotion: EmotionState
  ): Promise<string> {
    // 根据状态选择响应策略
    switch (stateDecision.nextState) {
      case 'TAROT_ENTRY':
        return this.handleTarotEntry(userInput, sessionState, emotion);

      case 'EMPATHY_PHASE':
        return this.handleEmpathyPhase(
          userInput, sessionState, empathyInstruction, constraints, emotion
        );

      case 'EXPLORE_PHASE':
        return this.handleExplorePhase(
          userInput, sessionState, empathyInstruction, constraints, emotion
        );

      case 'ACTION_PHASE':
        return this.handleActionPhase(userInput, sessionState, emotion);

      case 'REVIEW_PHASE':
        return this.handleReviewPhase(userInput, sessionState, emotion);

      default:
        return this.handleDefaultResponse(
          userInput, sessionState, empathyInstruction, emotion
        );
    }
  }

  /**
   * 处理塔罗入口
   */
  private handleTarotEntry(
    userInput: string,
    sessionState: SessionState,
    emotion: EmotionState
  ): string {
    // 检查是否可以触发塔罗
    if (!this.tarotManager.shouldTrigger(sessionState.userId, sessionState.sessionId, 'user_request')) {
      return '我们直接聊吧。最近有什么想说的？';
    }

    // 获取入口推荐
    const recommendation = this.tarotManager.getEntryRecommendation(
      sessionState.userId, sessionState.sessionId
    );

    return recommendation.greeting;
  }

  /**
   * 处理共情阶段
   */
  private handleEmpathyPhase(
    userInput: string,
    sessionState: SessionState,
    empathyInstruction: string,
    constraints: StateConstraints,
    emotion: EmotionState
  ): string {
    // 构建共情提示词
    const empathyPrompt = this.empathyEngine.generateEmpathyPrompt(
      {
        level: sessionState.currentEmpathyLevel as any,
        strategy: this.empathyEngine['EMPATHY_STRATEGIES']?.[sessionState.currentEmpathyLevel] || { name: '标准共情' },
        reasoning: empathyInstruction,
        safetyFlags: [],
        immediateActions: [],
      } as any,
      {
        primaryEmotion: { name: emotion.primaryEmotion, description: '' },
        intensity: emotion.intensity,
        valence: emotion.valence,
        arousal: emotion.arousal,
        dominance: 0.5,
        confidence: 0.8,
        contextualFactors: [],
        rawAnalysis: '',
      } as any,
      this.emotionTracker.analyzeTrajectory(sessionState.sessionId),
      userInput,
      sessionState.recentHistory.map(t => t.content)
    );

    // 在实际实现中，这里会调用 LLM
    // MVP 阶段返回模板响应
    return this.generateEmpathyResponse(emotion, sessionState.currentEmpathyLevel, userInput);
  }

  /**
   * 生成共情响应（MVP 模板）
   */
  private generateEmpathyResponse(emotion: EmotionState, level: EmpathyLevel, userInput: string): string {
    const responses: Record<EmpathyLevel, string[]> = {
      L1: [
        `我听到你说"${userInput.substring(0, 20)}"，这听起来你正在经历很大的痛苦。`,
        `我能感受到你现在很不好。你愿意多说一点吗？`,
      ],
      L2: [
        `你提到"${userInput.substring(0, 15)}"，这种${emotion.primaryEmotion}的感觉是可以理解的。`,
        `${emotion.intensity > 0.5 ? '这种感觉很强烈' : '我听到了'}，你不需要一个人扛着。`,
      ],
      L3: [
        `很多人都会经历这样的阶段，你不是一个人。`,
        `你愿意说说是什么让你有这种感觉吗？`,
      ],
      L4: [
        `你刚才说的这些，我感觉到你内心有一些很重要的东西。`,
        `你提到的"${userInput.substring(0, 10)}"，这背后可能有什么更深的原因？`,
      ],
      L5: [
        `你说的这些很有洞察力。你觉得下一步可以做什么？`,
        `如果有一个小小的、你可以尝试的事情，会是什么？`,
      ],
    };

    const options = responses[level] || responses.L2;
    return options[Math.floor(Math.random() * options.length)];
  }

  /**
   * 处理探索阶段
   */
  private handleExplorePhase(
    userInput: string,
    sessionState: SessionState,
    empathyInstruction: string,
    constraints: StateConstraints,
    emotion: EmotionState
  ): string {
    // 探索阶段的响应模板
    const explorationResponses = [
      `你说"${userInput.substring(0, 15)}"，能再具体一点吗？是哪些方面让你有这种感觉？`,
      `我听到你提到了一些很重要的东西。你觉得自己最在意的是什么？`,
      `如果把你现在的状态画成一幅图，会是什么样的？`,
    ];

    return explorationResponses[Math.floor(Math.random() * explorationResponses.length)];
  }

  /**
   * 处理行动阶段
   */
  private handleActionPhase(
    userInput: string,
    sessionState: SessionState,
    emotion: EmotionState
  ): string {
    return `你愿意试试看吗？不需要想太多，就一个小步骤。`;
  }

  /**
   * 处理复盘阶段
   */
  private handleReviewPhase(
    userInput: string,
    sessionState: SessionState,
    emotion: EmotionState
  ): string {
    return `我们聊了一段时间了，要不要回顾一下？看看有什么变化？`;
  }

  /**
   * 默认响应
   */
  private handleDefaultResponse(
    userInput: string,
    sessionState: SessionState,
    empathyInstruction: string,
    emotion: EmotionState
  ): string {
    return `我听到了你说"${userInput.substring(0, 20)}"。你愿意多说一点吗？`;
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
      memoryOperationsPending: [],
      kvCacheValid: false,
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

    return state;
  }

  /**
   * 构建共情指令
   */
  private buildEmpathyInstruction(
    decision: StateDecision,
    emotion: EmotionState,
    sessionState: SessionState
  ): string {
    const parts: string[] = [];

    parts.push(`【当前阶段】：${decision.nextState}`);
    parts.push(`【共情层级】：${decision.empathyLevel}（在此范围内选择策略）`);
    parts.push(`【用户情绪】：${emotion.primaryEmotion}（强度 ${emotion.intensity.toFixed(2)}，趋势 ${emotion.trajectory}）`);

    if (!decision.shouldProgress) {
      parts.push('【重要】：当前不推进到下一阶段。只做共情，不要问引导性问题。');
    } else {
      parts.push('【可以推进】：可以在共情后问一个温和的问题。');
    }

    // 状态特定约束
    const constraints = decision.constraints;
    if (constraints.noActionQuestions) parts.push('【约束】：不问行动问题');
    if (constraints.empathyOnly) parts.push('【约束】：只做共情');
    if (constraints.maxEmpathyRounds) parts.push(`【约束】：最多 ${constraints.maxEmpathyRounds} 轮共情`);

    return parts.join('\n');
  }

  // ==================== 会话生命周期 ====================

  /**
   * 检查会话健康状态
   */
  checkSessionHealth(sessionId: string): { status: string; message?: string } {
    const state = this.sessionStates.get(sessionId);
    if (!state) return { status: 'not_found' };

    const now = Date.now();
    const lastChange = new Date(state.lastStateChangeAt).getTime();
    const started = new Date(state.startedAt).getTime();

    // 不活跃超时
    if (now - lastChange > this.config.inactivityTimeout * 1000) {
      return { status: 'timeout', message: '会话超时' };
    }

    // 总时长超限
    if (now - started > this.config.sessionMaxDuration * 1000) {
      return { status: 'duration_limit', message: '会话时长超限' };
    }

    // 轮次超限
    if (state.turnCount >= this.config.maxTurnsPerSession) {
      return { status: 'turn_limit', message: '轮次超限' };
    }

    return { status: 'healthy' };
  }

  /**
   * 结束会话
   */
  endSession(sessionId: string): SessionState | null {
    const state = this.sessionStates.get(sessionId);
    if (!state) return null;

    state.currentState = 'SESSION_CLOSE';
    state.stateHistory.push({
      fromState: state.currentState,
      toState: 'SESSION_CLOSE',
      timestamp: new Date().toISOString(),
      reason: '会话结束',
      turnCount: state.turnCount,
    });

    this.sessionStates.set(sessionId, state);
    return state;
  }

  /**
   * 获取会话状态
   */
  getSessionState(sessionId: string): SessionState | undefined {
    return this.sessionStates.get(sessionId);
  }

  /**
   * 获取旅程阶段指导
   */
  getJourneyGuidance(sessionId: string) {
    const state = this.sessionStates.get(sessionId);
    if (!state) return null;
    return this.journeyTracker.getGuidance(state.journeyStage);
  }
}
