/**
 * 意图识别与路由模块 - 数据类型定义
 *
 * 三层意图架构：
 * Layer 1: 安全意图（最高优先级）
 * Layer 2: 交互模式意图（决定用什么子系统响应）
 * Layer 3: 细粒度子意图（辅助路由决策）
 */

// ==================== Layer 1: 安全意图 ====================

/** Layer 1 安全意图 */
export type SafetyIntent =
  | 'L1.1_crisis_help'     // 危机求助
  | 'L1.2_self_harm'       // 自伤/自杀表达
  | 'L1.3_harm_others';    // 伤害他人表达

// ==================== Layer 2: 交互模式意图 ====================

/** Layer 2 交互模式意图 */
export type InteractionIntent =
  | 'L2.1_emotional_venting'     // 情绪倾诉
  | 'L2.2_exploration_request'   // 探索求助
  | 'L2.3_action_discussion'     // 行动讨论
  | 'L2.4_review_request'        // 复盘回顾
  | 'L2.5_advice_seeking'        // 寻求建议
  | 'L2.6_information_query'     // 信息查询
  | 'L2.7_meta_conversation'     // 元对话
  | 'L2.8_relationship_building' // 关系建立
  | 'L2.9_ambiguous_intent';     // 意图不明

// ==================== Layer 3: 细粒度子意图 ====================

/** L2.1 情绪倾诉子意图 */
export type EmotionalVentingSubIntent =
  | 'L2.1a_venting'           // 宣泄型
  | 'L2.1b_seeking_resonance' // 寻求共鸣型
  | 'L2.1c_seeking_normalize' // 寻求正常化型
  | 'L2.1d_silent_venting';   // 沉默倾诉型

/** L2.2 探索求助子意图 */
export type ExplorationSubIntent =
  | 'L2.2a_value_sorting'          // 价值梳理型
  | 'L2.2b_conflict_clarification' // 冲突澄清型
  | 'L2.2c_cause_seeking'          // 原因探寻型
  | 'L2.2d_direction_finding';     // 方向寻找型

/** L2.3 行动讨论子意图 */
export type ActionSubIntent =
  | 'L2.3a_decision_agonizing' // 决策纠结型
  | 'L2.3b_action_planning'    // 行动规划型
  | 'L2.3c_result_sharing'     // 结果分享型
  | 'L2.3d_action_blocked';    // 行动阻塞型

/** L2.5 寻求建议子意图 */
export type AdviceSubIntent =
  | 'L2.5a_career_advice'    // 职业建议型
  | 'L2.5b_psychological'    // 心理技巧型
  | 'L2.5c_resource_recomm'  // 信息推荐型
  | 'L2.5d_decision_replace'; // 决策替代型

/** L2.6 信息查询子意图 */
export type InfoQuerySubIntent =
  | 'L2.6a_ai_identity'    // AI身份型
  | 'L2.6b_feature_usage'  // 功能使用型
  | 'L2.6c_privacy'        // 隐私安全型
  | 'L2.6d_methodology';   // 方法论型

/** L2.7 元对话子意图 */
export type MetaConversationSubIntent =
  | 'L2.7a_negative_feedback'  // 负面反馈型
  | 'L2.7b_positive_feedback'  // 正面反馈型
  | 'L2.7c_style_adjustment'   // 方式调整型
  | 'L2.7d_topic_switch';      // 话题切换型

/** L2.8 关系建立子意图 */
export type RelationshipSubIntent =
  | 'L2.8a_trust_test'           // 信任测试型
  | 'L2.8b_boundary_confirm'     // 边界确认型
  | 'L2.8c_safety_seeking'       // 安全感建立型
  | 'L2.8d_anthropomorphism';    // 拟人化试探型

/** 子意图联合类型 */
export type SubIntent =
  | EmotionalVentingSubIntent
  | ExplorationSubIntent
  | ActionSubIntent
  | AdviceSubIntent
  | InfoQuerySubIntent
  | MetaConversationSubIntent
  | RelationshipSubIntent;

// ==================== 意图识别结果 ====================

/** 意图识别结果 */
export interface IntentRecognitionResult {
  /** 是否为安全意图 */
  isSafetyIntent: boolean;
  /** Layer 1 安全意图（如果命中） */
  safetyIntent?: SafetyIntent;
  /** Layer 2 主意图 */
  primaryIntent: InteractionIntent;
  /** Layer 2 次意图 */
  secondaryIntent?: InteractionIntent;
  /** Layer 3 子意图 */
  subIntent?: SubIntent;
  /** 主意图置信度 */
  confidence: number;
  /** 识别层级（0/1/2） */
  recognitionLevel: number;
  /** 判断依据 */
  reasoning: string;
  /** 歧义说明 */
  ambiguityNote?: string;
  /** 上下文线索 */
  contextClues: string[];
  /** 安全关注度 */
  safetyAttention: 'none' | 'low' | 'medium' | 'high';
}

// ==================== 路由决策 ====================

/** 路由目标 */
export type RouteTarget =
  | 'SAFETY_PROTOCOL'
  | 'EMPATHY_MODULE'
  | 'EXPLORE_MODULE'
  | 'ACTION_MODULE'
  | 'REVIEW_MODULE'
  | 'INFO_SERVICE'
  | 'META_HANDLER'
  | 'RELATIONSHIP_HANDLER'
  | 'ADVICE_HANDLER';

/** 路由优先级 */
export type RoutePriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

/** 路由策略 */
export type RouteStrategy =
  | 'immediate_response'
  | 'assess_then_intervene'
  | 'emotion_first'
  | 'explore_with_empathy'
  | 'action_focused'
  | 'guided_review'
  | 'redirect_to_explore'
  | 'direct_answer'
  | 'adjust_based_on_feedback'
  | 'build_trust'
  | 'empathy_with_intent_probe';

/** 路由决策结果 */
export interface RouteDecision {
  /** 路由目标 */
  target: RouteTarget;
  /** 目标子状态 */
  subState?: string;
  /** 优先级 */
  priority: RoutePriority;
  /** 是否覆盖状态机 */
  overridesStateMachine: boolean;
  /** 路由策略 */
  strategy: RouteStrategy;
  /** 给目标模块的策略提示 */
  strategyHints: string[];
  /** 状态机提示 */
  stateMachineHints: StateMachineHints;
  /** 兜底方案 */
  fallback?: RouteTarget;
  /** 是否返回之前状态 */
  returnToPreviousState: boolean;
  /** 延迟意图（用于下一轮） */
  deferredIntent?: InteractionIntent;
}

/** 状态机提示 */
export interface StateMachineHints {
  /** 强制进入共情阶段 */
  forceEmpathyPhase?: boolean;
  /** 允许推进 */
  allowProgression?: boolean;
  /** 最大共情轮次 */
  maxEmpathyRounds?: number | 'unlimited';
  /** 检查情绪后再进入 */
  checkEmotionBeforeEntering?: boolean;
  /** 情绪高时路由到共情 */
  ifEmotionHigh?: string;
  /** 在共情中嵌入意图探测 */
  includeIntentProbe?: boolean;
}

// ==================== 元对话反馈 ====================

/** 元对话反馈类型 */
export type MetaFeedbackType =
  | 'negative'         // 负面反馈
  | 'positive'         // 正面反馈
  | 'style_adjustment' // 方式调整
  | 'topic_switch';    // 话题切换

/** 元对话反馈记录 */
export interface MetaFeedbackRecord {
  type: MetaFeedbackType;
  details: Record<string, unknown>;
  timestamp: string;
  stateAtTime: string;
}

/** 反馈模式分析结果 */
export interface FeedbackPattern {
  pattern: string;
  action: string;
  message?: string;
  preference?: string;
  hint?: string;
}

// ==================== 模块配置 ====================

/** 意图识别配置 */
export interface IntentConfig {
  /** 是否启用安全快筛 */
  enableSafetyScreen: boolean;
  /** Level 1 置信度阈值 */
  level1ConfidenceThreshold: number;
  /** 默认策略（意图不明时） */
  defaultStrategy: RouteStrategy;
}

/** 默认配置 */
export const DEFAULT_INTENT_CONFIG: IntentConfig = {
  enableSafetyScreen: true,
  level1ConfidenceThreshold: 0.8,
  defaultStrategy: 'empathy_with_intent_probe',
};
