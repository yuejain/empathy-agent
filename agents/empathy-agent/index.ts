/**
 * 情感共情陪伴Agent - 完整主入口
 * 基于EdgeOne Makers平台，使用LangGraph框架
 *
 * 集成模块：
 * - 对话状态机与流程编排器（orchestrator）
 * - 意图识别与路由（intent）
 * - 安全分类器（safety-classifier）
 * - 记忆系统（memory）
 * - 塔罗破冰（tarot）
 * - 情感共情（emotion + empathy）
 *
 * 完整处理流水线：
 * ① 意图识别 → ② 安全分类 → ③ 状态机决策 →
 * ④ 记忆检索 → ⑤ 上下文组装 → ⑥ LLM 生成 →
 * ⑦ 输出过滤 → ⑧ 状态更新 → ⑨ 返回用户
 */

import { StateGraph, MessagesAnnotation, START, END, Annotation } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { sseEvent, createSSEResponse } from '../_shared';

// 导入所有核心模块
import { ConversationOrchestrator } from '../../lib/orchestrator';
import { IntentClassifier, IntentRouter } from '../../lib/intent';
import { SafetyClassifier } from '../../lib/safety-classifier';
import { MemoryPipeline } from '../../lib/memory';
import { TarotInteractionManager } from '../../lib/tarot';
import { EmotionRecognizer } from '../../lib/emotion-recognition';
import { EmotionTracker } from '../../lib/emotion-tracker';
import { EmpathyDecisionEngine, OutputFilter } from '../../lib/empathy-decision';

// ==================== 模型初始化 ====================

const MODEL_NAME = '@makers/deepseek-v4-flash';

let _model: ChatOpenAI | null = null;
function getModel(env: Record<string, string>): ChatOpenAI {
  if (_model) return _model;
  _model = new ChatOpenAI({
    model: MODEL_NAME,
    apiKey: env.AI_GATEWAY_API_KEY,
    configuration: { baseURL: env.AI_GATEWAY_BASE_URL },
    temperature: 0.7,
    timeout: 300_000,
  });
  return _model;
}

// ==================== 模块单例管理 ====================

/** 编排器实例 */
let _orchestrator: ConversationOrchestrator | null = null;
function getOrchestrator(env: Record<string, string>): ConversationOrchestrator {
  if (!_orchestrator) {
    _orchestrator = new ConversationOrchestrator(env);
  }
  return _orchestrator;
}

// ==================== 会话历史管理 ====================

interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  emotion?: {
    primary: string;
    intensity: number;
    valence: number;
  };
}

const sessionHistories = new Map<string, ConversationTurn[]>();

function getSessionHistory(sessionId: string): ConversationTurn[] {
  if (!sessionHistories.has(sessionId)) {
    sessionHistories.set(sessionId, []);
  }
  return sessionHistories.get(sessionId)!;
}

function addToHistory(sessionId: string, turn: ConversationTurn): void {
  const history = getSessionHistory(sessionId);
  history.push(turn);
  // 保留最近20轮
  if (history.length > 20) {
    history.splice(0, history.length - 20);
  }
}

// ==================== Agent状态定义 ====================

interface EmpathyAgentState {
  messages: any[];
  conversationId?: string;
  userInput?: string;
}

// ==================== 核心处理节点 ====================

/**
 * 主Agent处理节点 - 使用编排器协调所有模块
 */
async function empathyAgentNode(
  state: EmpathyAgentState,
  env: Record<string, string>
) {
  const { messages, userInput, conversationId } = state;

  if (!userInput) {
    return {
      messages: [{
        role: 'assistant',
        content: JSON.stringify({
          type: 'ai_response',
          content: '请输入您想说的话。',
          emotion: { primary: 'neutral', intensity: 0.3, valence: 0 },
          empathy: { level: 'L2', strategy: '等待输入' },
          safety: { isSafe: true, riskLevel: 'low' },
          state: { current: 'INIT', phase: '等待输入' },
        })
      }]
    };
  }

  try {
    const sessionId = conversationId || 'default';
    const userId = 'user_' + sessionId.split('_')[0];

    // 获取编排器
    const orchestrator = getOrchestrator(env);

    // 获取或创建会话状态
    let sessionState = orchestrator.getSessionState(sessionId);

    // 构建编排器输入
    const orchestratorInput = {
      userId,
      sessionId,
      userInput,
      sessionState: sessionState || {
        sessionId,
        userId,
        startedAt: new Date().toISOString(),
        turnCount: 0,
        currentState: 'INIT' as const,
        stateHistory: [],
        journeyStage: 'journey_stage_1' as const,
        emotionTrajectory: [],
        currentEmotion: {
          primaryEmotion: 'neutral',
          intensity: 0.3,
          valence: 0,
          arousal: 0.3,
          trajectory: 'stable' as const,
          secondaryEmotions: [],
          riskLevel: 'low' as const,
          timestamp: new Date().toISOString(),
        },
        consecutiveHighEmotionTurns: 0,
        consecutiveDecliningTurns: 0,
        currentEmpathyLevel: 'L2' as const,
        empathyRounds: 0,
        empathyStrategyHistory: [],
        userModelSnapshot: {},
        retrievedMemories: [],
        memoryOperationsPending: [],
        kvCacheValid: false,
        recentHistory: [],
        activeDirectionCards: [],
        activeExperiments: [],
        lastStateChangeAt: new Date().toISOString(),
        warnings: [],
      },
    };

    // 执行编排流水线
    const result = await orchestrator.processTurn(orchestratorInput);

    // 记录到历史
    addToHistory(sessionId, {
      role: 'user',
      content: userInput,
      timestamp: new Date().toISOString(),
      emotion: {
        primary: result.metadata.emotion.primaryEmotion,
        intensity: result.metadata.emotion.intensity,
        valence: result.metadata.emotion.valence,
      },
    });

    addToHistory(sessionId, {
      role: 'assistant',
      content: result.response,
      timestamp: new Date().toISOString(),
    });

    // 构建响应数据
    const responseData = {
      type: 'ai_response',
      content: result.response,
      emotion: {
        primary: result.metadata.emotion.primaryEmotion,
        intensity: result.metadata.emotion.intensity,
        valence: result.metadata.emotion.valence,
        arousal: result.metadata.emotion.arousal,
        trajectory: result.metadata.emotion.trajectory,
      },
      empathy: {
        level: result.metadata.empathyLevel,
        strategy: getEmpathyStrategyName(result.metadata.empathyLevel),
      },
      safety: {
        isSafe: result.metadata.safetyResult.riskLevel !== 'high',
        riskLevel: result.metadata.safetyResult.riskLevel,
        warnings: result.metadata.safetyResult.evidence,
      },
      state: {
        current: result.metadata.state,
        subState: result.metadata.subState,
        phase: getStatePhaseName(result.metadata.state),
      },
      memory: {
        memoriesUsed: result.metadata.memoryUsed,
        processingTimeMs: result.metadata.processingTimeMs,
      },
      quality: {
        score: 0.85, // TODO: 从输出过滤器获取
        warnings: [],
      },
    };

    return {
      messages: [{
        role: 'assistant',
        content: JSON.stringify(responseData)
      }]
    };
  } catch (error) {
    console.error('Agent处理错误:', error);
    return {
      messages: [{
        role: 'assistant',
        content: JSON.stringify({
          type: 'error_message',
          content: '抱歉，处理您的请求时出现了错误。请稍后再试。',
          error: (error as Error).message,
        })
      }]
    };
  }
}

// ==================== 辅助函数 ====================

function getEmpathyStrategyName(level: string): string {
  const strategies: Record<string, string> = {
    'L1': '安全优先',
    'L2': '情绪命名+验证',
    'L3': '正常化+去标签化',
    'L4': '深度共情+镜像',
    'L5': '温和推进+行动实验',
  };
  return strategies[level] || '标准共情';
}

function getStatePhaseName(state: string): string {
  const phases: Record<string, string> = {
    'INIT': '初始化',
    'SAFETY_SCREEN': '安全筛查',
    'ENTRY_SELECT': '入口选择',
    'TAROT_ENTRY': '塔罗破冰',
    'IMAGE_ENTRY': '图片投射',
    'DIRECT_ENTRY': '直接对话',
    'EMPATHY_PHASE': '共情阶段',
    'EXPLORE_PHASE': '探索阶段',
    'ACTION_PHASE': '行动阶段',
    'REVIEW_PHASE': '复盘阶段',
    'SESSION_CLOSE': '会话结束',
    'SAFETY_PROTOCOL': '安全协议',
  };
  return phases[state] || state;
}

// ==================== LangGraph图构建 ====================

function buildEmpathyGraph(env: Record<string, string>) {
  const model = getModel(env);

  const EmpathyAnnotation = Annotation.Root({
    ...MessagesAnnotation.spec,
    userInput: Annotation<string>({ reducer: (_x, y) => y, default: () => '' }),
    conversationId: Annotation<string>({ reducer: (_x, y) => y, default: () => '' }),
  });

  async function agentNode(state: typeof EmpathyAnnotation.State) {
    const result = await empathyAgentNode(state, env);
    return { messages: result.messages };
  }

  function shouldContinue(state: typeof EmpathyAnnotation.State): 'agent' | '__end__' {
    const last = state.messages[state.messages.length - 1] as any;
    if (last?.tool_calls?.length) return 'agent';
    return '__end__';
  }

  return new StateGraph(EmpathyAnnotation)
    .addNode('agent', agentNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', shouldContinue)
    .compile();
}

// ==================== SSE事件流生成器 ====================

async function* empathyEventStream(
  graph: any,
  userInput: string,
  conversationId: string,
  signal?: AbortSignal
) {
  try {
    const stream = await graph.stream(
      {
        messages: [{ role: 'user', content: userInput }],
        userInput,
        conversationId
      },
      {
        streamMode: 'messages',
        signal,
        configurable: { thread_id: conversationId }
      }
    );

    for await (const chunk of stream) {
      if (signal?.aborted) break;

      const [msg] = chunk;
      if (msg.tool_call_chunks?.length) {
        for (const tc of msg.tool_call_chunks) {
          if (tc.name) {
            yield sseEvent({ type: 'tool_call', name: tc.name }, 'tool_call');
          }
        }
      } else if (msg.type === 'tool') {
        yield sseEvent({
          type: 'tool_result',
          name: msg.name,
          content: msg.text?.slice(0, 500) ?? ''
        }, 'tool_result');
      } else if (msg.text) {
        try {
          const responseData = JSON.parse(msg.text);
          yield sseEvent(responseData, responseData.type || 'ai_response');
        } catch {
          yield sseEvent({ type: 'ai_response', content: msg.text }, 'ai_response');
        }
      }
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError' && !signal?.aborted) {
      yield sseEvent({
        type: 'error_message',
        content: (e as Error).message
      }, 'error_message');
    }
  }

  yield 'data: [DONE]\n\n';
}

// ==================== 主入口函数 ====================

export async function onRequest(context: any) {
  const { request, env, conversation_id: conversationId, store } = context;
  const { message, userInput } = request?.body ?? {};

  const actualInput = userInput || message;
  if (!actualInput) {
    return new Response(
      JSON.stringify({ error: 'Missing message or userInput' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const signal = request?.signal as AbortSignal | undefined;
  const model = getModel(env);

  // 构建图
  const graph = buildEmpathyGraph(env);

  // 返回SSE响应
  return createSSEResponse(
    (sig) => empathyEventStream(graph, actualInput, conversationId, sig),
    signal
  );
}

// ==================== 停止端点 ====================

export async function onRequestPost(context: any) {
  const { request, env } = context;
  const { conversation_id } = request?.body ?? {};

  if (!conversation_id) {
    return new Response(
      JSON.stringify({ error: 'Missing conversation_id' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 结束会话
  try {
    const orchestrator = getOrchestrator(env);
    const sessionState = orchestrator.endSession(conversation_id);

    if (sessionState) {
      // 生成会话摘要（如果有记忆模块）
      const history = getSessionHistory(conversation_id);
      console.log(`会话 ${conversation_id} 结束，共 ${history.length} 轮`);
    }
  } catch (error) {
    console.error('会话结束处理失败:', error);
  }

  return new Response(
    JSON.stringify({
      success: true,
      message: `已停止对话 ${conversation_id}`
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
