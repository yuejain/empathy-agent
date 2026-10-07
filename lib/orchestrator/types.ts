/**
 * 对话状态机与流程编排器 - 数据类型定义
 *
 * 状态机 = 阶段边界 + 转换条件 + 阶段内自由度
 * 编排器 = 每一步具体做什么、调用哪些模块、传递什么参数
 */

// ==================== 全局状态 ====================

/** 全局状态 */
export type GlobalState =
  | 'INIT'              // 会话初始化
  | 'SAFETY_SCREEN'     // 安全筛查
  | 'ENTRY_SELECT'      // 选择破冰入口
  | 'TAROT_ENTRY'       // 塔罗破冰
  | 'IMAGE_ENTRY'       // 图片投射
  | 'DIRECT_ENTRY'      // 直接对话
  | 'EMPATHY_PHASE'     // 共情阶段
  | 'EXPLORE_PHASE'     // 结构化探索
  | 'ACTION_PHASE'      // 行动实验
  | 'REVIEW_PHASE'      // 复盘阶段
  | 'SESSION_CLOSE'     // 会话结束
  | 'SAFETY_PROTOCOL';  // 安全协议

/** 塔罗入口子状态 */
export type TarotSubState =
  | 'TAROT_INIT'
  | 'TAROT_INVITE'
  | 'TAROT_GENTLE_OFFER'
  | 'TAROT_DRAW'
  | 'TAROT_FLIP'
  | 'TAROT_ASPECT_SELECT'
  | 'TAROT_EMPATHIZE_A'
  | 'TAROT_EMPATHIZE_B'
  | 'TAROT_EXPLORE_C'
  | 'TAROT_MISS';

/** 共情阶段子状态 */
export type EmpathySubState =
  | 'EMPATHY_HIGH'              // 高强度情绪
  | 'EMPATHY_MID'               // 中等情绪
  | 'EMPATHY_READY_TO_EXPLORE'  // 准备探索
  | 'EMPATHY_STABILIZE';        // 稳定陪伴

/** 探索阶段子状态 */
export type ExploreSubState =
  | 'EXPLORE_ENTRY'
  | 'EXPLORE_CLARIFY'
  | 'EXPLORE_MAP'
  | 'EXPLORE_HYPOTHESIZE'
  | 'EXPLORE_DESIGN';

/** 行动阶段子状态 */
export type ActionSubState =
  | 'ACTION_PLAN'
  | 'ACTION_WAIT'
  | 'ACTION_CHECK_IN'
  | 'ACTION_RESULT'
  | 'ACTION_INSIGHT'
  | 'ACTION_NEXT'
  | 'ACTION_EXPLORE_BLOCK'
  | 'ACTION_PARTIAL';

/** 复盘阶段子状态 */
export type ReviewSubState =
  | 'REVIEW_TRIGGER'
  | 'REVIEW_VALUES'
  | 'REVIEW_THEMES'
  | 'REVIEW_CARDS'
  | 'REVIEW_EMPATHY'
  | 'REVIEW_SUMMARY';

/** 子状态联合类型 */
export type SubState =
  | TarotSubState
  | EmpathySubState
  | ExploreSubState
  | ActionSubState
  | ReviewSubState;

// ==================== 旅程阶段 ====================

/** 多会话旅程阶段 */
export type JourneyStage =
  | 'journey_stage_1'  // 觉察与稳定
  | 'journey_stage_2'  // 具体化与梳理
  | 'journey_stage_3'  // 行动与验证
  | 'journey_stage_4'; // 整合与方向

/** 旅程阶段指导 */
export interface JourneyStageGuidance {
  primaryGoal: string;
  recommendedStates: GlobalState[];
  avoidStates: GlobalState[];
  sessionOpeningStrategy: string;
  maxExploreDepth: number;
  pacing: 'slow' | 'medium' | 'gentle';
}

// ==================== 状态转换 ====================

/** 状态转换规则 */
export interface TransitionRule {
  targetState: GlobalState;
  targetSubState?: SubState;
  conditions: TransitionCondition[];
  basePriority: number;
  allowsProgression: boolean;
  isRetreat: boolean;
  respectsUserPace: boolean;
  maxTurnsInState?: number;
  requiresEmotionLow: boolean;
  requiresEmotionDeclining: boolean;
  reason: string;
}

/** 转换条件 */
export interface TransitionCondition {
  type: 'emotion' | 'user_signal' | 'turn_count' | 'safety' | 'custom';
  operator: 'eq' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'contains';
  value: any;
  description: string;
}

/** 状态转换历史记录 */
export interface StateTransitionRecord {
  fromState: GlobalState;
  fromSubState?: SubState;
  toState: GlobalState;
  toSubState?: SubState;
  timestamp: string;
  reason: string;
  emotionIntensity?: number;
  turnCount: number;
}

// ==================== 状态决策 ====================

/** 状态决策输出 */
export interface StateDecision {
  nextState: GlobalState;
  nextSubState?: SubState;
  empathyLevel: EmpathyLevel;
  shouldProgress: boolean;
  constraints: StateConstraints;
  reason: string;
  transitionScore: number;
}

/** 共情层级 */
export type EmpathyLevel = 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

/** 状态约束 */
export interface StateConstraints {
  /** 不问行动问题 */
  noActionQuestions?: boolean;
  /** 不推进到下一阶段 */
  noProgression?: boolean;
  /** 只做共情 */
  empathyOnly?: boolean;
  /** 不做牌义解读 */
  noTarotInterpretation?: boolean;
  /** 最大共情轮次 */
  maxEmpathyRounds?: number;
  /** 最大探索轮次 */
  maxExploreRounds?: number;
  /** 禁止的话题 */
  bannedTopics?: string[];
  /** 必须做的事 */
  requiredActions?: string[];
}

// ==================== 情绪状态 ====================

/** 情绪状态 */
export interface EmotionState {
  primaryEmotion: string;
  intensity: number;
  valence: number;
  arousal: number;
  trajectory: 'rising' | 'stable' | 'declining' | 'fluctuating';
  secondaryEmotions: string[];
  riskLevel: 'low' | 'medium' | 'high';
  timestamp: string;
}

// ==================== 会话状态 ====================

/** 对话轮次 */
export interface Turn {
  role: 'user' | 'assistant';
  content: string;
  state: GlobalState;
  subState?: SubState;
  timestamp: string;
  emotion?: EmotionState;
}

/** 会话状态 */
export interface SessionState {
  // 基础信息
  sessionId: string;
  userId: string;
  startedAt: string;
  turnCount: number;
  lastActiveAt?: string;
  explicitMemories?: string[];
  tarotDraws?: number;

  // 状态机状态
  currentState: GlobalState;
  currentSubState?: SubState;
  stateHistory: StateTransitionRecord[];
  journeyStage: JourneyStage;

  // 情绪追踪
  emotionTrajectory: EmotionState[];
  currentEmotion: EmotionState;
  consecutiveHighEmotionTurns: number;
  consecutiveDecliningTurns: number;

  // 共情追踪
  currentEmpathyLevel: EmpathyLevel;
  empathyRounds: number;
  empathyStrategyHistory: string[];

  // 记忆相关
  userModelSnapshot: Record<string, unknown>;
  retrievedMemories: unknown[];
  memoryOperationsPending: unknown[];
  kvCacheValid: boolean;

  // 塔罗相关
  tarotState?: TarotSubState;

  // 对话历史
  recentHistory: Turn[];

  // 探索进度
  currentExploration?: {
    topic: string;
    subState: ExploreSubState;
    hypothesis?: string;
  };
  activeDirectionCards: unknown[];
  activeExperiments: unknown[];

  // 元数据
  lastStateChangeAt: string;
  warnings: string[];
}

// ==================== 编排器输入输出 ====================

/** 编排器输入 */
export interface OrchestratorInput {
  userId: string;
  sessionId: string;
  userInput: string;
  sessionState?: SessionState;
  signal?: AbortSignal;
  onDelta?: (content: string) => Promise<void> | void;
  backend?: 'cloud' | 'local';
}

/** 编排器输出 */
export interface OrchestratorOutput {
  response: string;
  updatedState: SessionState;
  metadata: {
    state: GlobalState;
    subState?: SubState;
    empathyLevel: EmpathyLevel;
    emotion: EmotionState;
    safetyResult: SafetyResult;
    memoryUsed: number;
    processingTimeMs: number;
    mode?: 'demo' | 'live';
    quality?: { score: number; warnings: string[] };
    sources?: { source: string; source_url: string; license: string; score: number }[];
    analysisSource?: string;
    backend?: 'cloud' | 'local';
  };
}

/** 安全检查结果 */
export interface SafetyResult {
  riskLevel: 'low' | 'medium' | 'high';
  riskType?: string;
  evidence: string[];
  shouldBlock: boolean;
  safetyResponse?: string;
}

// ==================== 编排器配置 ====================

/** 编排器配置 */
export interface OrchestratorConfig {
  /** 每会话最大轮次 */
  maxTurnsPerSession: number;
  /** 不活跃超时（秒） */
  inactivityTimeout: number;
  /** 会话最大时长（秒） */
  sessionMaxDuration: number;
  /** 共情阶段最大轮次 */
  maxEmpathyRounds: number;
  /** 探索阶段最大轮次 */
  maxExploreRounds: number;
  /** 情绪强度阈值（高于此值不推进） */
  emotionIntensityThreshold: number;
  /** 情绪下降阈值 */
  emotionDecliningThreshold: number;
  /** 连续高情绪轮次阈值 */
  consecutiveHighEmotionThreshold: number;
  /** 是否启用 KV Cache */
  enableKvCache: boolean;
}

/** 默认配置 */
export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxTurnsPerSession: 50,
  inactivityTimeout: 30 * 60,
  sessionMaxDuration: 3 * 3600,
  maxEmpathyRounds: 4,
  maxExploreRounds: 10,
  emotionIntensityThreshold: 0.7,
  emotionDecliningThreshold: 0.15,
  consecutiveHighEmotionThreshold: 3,
  enableKvCache: true,
};
