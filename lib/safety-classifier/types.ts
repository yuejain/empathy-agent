/**
 * 安全分类器 - 数据类型定义
 *
 * 三级风险分级：L0 Safe / L1 Caution / L2 Crisis
 * 四层融合检测：规则层 → 模型层 → 上下文层 → 融合决策层
 */

// ==================== 风险分级 ====================

/** 风险等级 */
export type RiskLevel = 'L0' | 'L1' | 'L2';

/** 风险等级详细定义 */
export interface RiskLevelDefinition {
  level: RiskLevel;
  label: string;           // Safe / Caution / Crisis
  labelCN: string;         // 安全 / 关注 / 危机
  description: string;
  typicalSignals: string[];
  responseStrategy: string;
}

/** L2 危机子类 */
export type CrisisSubtype =
  | 'suicide_self_harm'    // 自杀/自伤
  | 'violence_others'      // 他伤/暴力
  | 'abuse'                // 虐待
  | 'acute_psychosis'      // 急性精神病
  | 'substance_abuse'      // 物质滥用
  | 'eating_disorder'      // 进食障碍
  | 'none';

/** L2 危机子类定义 */
export interface CrisisSubtypeDefinition {
  subtype: CrisisSubtype;
  label: string;
  signals: string[];
  responseProtocol: string;  // 危机协议标识
}

// ==================== 各层输出 ====================

/** Layer 1: 规则层输出 */
export interface RuleLayerOutput {
  triggered: boolean;
  matchedKeywords: MatchedKeyword[];
  matchedPatterns: MatchedPattern[];
  preliminaryScore: number;    // 0-1
  preliminaryLevel: RiskLevel;
  processingTimeMs: number;
}

/** 匹配到的关键词 */
export interface MatchedKeyword {
  keyword: string;
  category: string;           // 风险子类别
  riskLevel: RiskLevel;
  weight: number;
  position: number;           // 在输入中的位置
  context: string;            // 周围上下文
}

/** 匹配到的正则模式 */
export interface MatchedPattern {
  pattern: string;
  patternName: string;
  riskLevel: RiskLevel;
  matchedText: string;
  position: number;
}

/** Layer 2: 模型层输出 */
export interface ModelLayerOutput {
  mainPrediction: RiskLevel;
  mainProbabilities: Record<RiskLevel, number>;
  subtypePredictions: Record<CrisisSubtype, number>;
  confidence: number;
  processingTimeMs: number;
}

/** Layer 3: 上下文层输出 */
export interface ContextLayerOutput {
  contextRiskLevel: RiskLevel;
  emotionTrend: EmotionTrend;
  topicEvolution: TopicEvolution;
  avoidanceDetected: boolean;
  escalationDetected: boolean;
  contextSummary: string;
  processingTimeMs: number;
}

/** 情绪趋势 */
export interface EmotionTrend {
  direction: 'improving' | 'stable' | 'declining' | 'fluctuating';
  slope: number;              // 线性回归斜率
  recentValences: number[];   // 最近5轮的效价
  sustainedNegative: boolean; // 连续3轮以上负面
}

/** 话题演变 */
export interface TopicEvolution {
  fromTopic: string;
  toTopic: string;
  isDangerousShift: boolean;  // 是否从一般困扰转向危险话题
  shiftDescription: string;
}

/** Layer 4: 融合决策输出 */
export interface FusionDecisionOutput {
  finalLevel: RiskLevel;
  finalSubtype: CrisisSubtype;
  confidence: number;
  fusionReasoning: string;
  layerAgreement: boolean;    // 各层是否一致
  uncertaintyFlag: boolean;   // 是否标记为不确定
  processingTimeMs: number;
}

// ==================== 综合结果 ====================

/** 安全分类结果 */
export interface SafetyClassificationResult {
  /** 最终风险等级 */
  riskLevel: RiskLevel;
  /** L2 危机子类（仅 L2 时有值） */
  crisisSubtype: CrisisSubtype;
  /** 综合置信度 */
  confidence: number;
  /** 各层输出 */
  layers: {
    rule: RuleLayerOutput;
    model: ModelLayerOutput;
    context: ContextLayerOutput;
    fusion: FusionDecisionOutput;
  };
  /** 风险标签列表 */
  riskTags: string[];
  /** 关键证据片段 */
  evidence: string[];
  /** 是否需要阻断对话 */
  shouldBlock: boolean;
  /** 是否需要人工接管 */
  needsHumanTakeover: boolean;
  /** 建议的响应策略 */
  suggestedResponse: string;
  /** 总处理时间 */
  totalProcessingTimeMs: number;
}

// ==================== 对话上下文 ====================

/** 对话轮次（用于上下文分析） */
export interface SafetyContextTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  riskLevel?: RiskLevel;      // 该轮的分类结果
  emotionValence?: number;    // 情绪效价
}

/** 安全状态记忆 */
export interface SafetyStateMemory {
  sessionId: string;
  hasTriggeredL1: boolean;
  hasTriggeredL2: boolean;
  crisisResourcesProvided: boolean;
  userReactionToIntervention: 'accepted' | 'rejected' | 'avoided' | 'unknown';
  consecutiveNegativeTurns: number;
  lastRiskLevel: RiskLevel;
  escalationCount: number;
  turnCount: number;
}

// ==================== 训练数据 ====================

/** 训练样本 */
export interface SafetyTrainingSample {
  id: string;
  text: string;
  context?: string[];         // 前几轮对话
  riskLevel: RiskLevel;
  crisisSubtype: CrisisSubtype;
  confidence: 'high' | 'medium' | 'low';
  evidenceSpans: Array<{
    start: number;
    end: number;
    label: string;
  }>;
  source: 'clinical' | 'public_dataset' | 'synthetic' | 'red_team';
  annotatorId: string;
  annotationTimestamp: string;
}

/** 标注统计 */
export interface AnnotationStatistics {
  totalSamples: number;
  byLevel: Record<RiskLevel, number>;
  bySubtype: Record<CrisisSubtype, number>;
  bySource: Record<string, number>;
  interAnnotatorAgreement: number;  // Krippendorff's Alpha
}

// ==================== 红队测试 ====================

/** 红队测试用例 */
export interface RedTeamTestCase {
  id: string;
  category: string;           // 测试类别
  attackType: string;         // 攻击类型
  input: string;
  context?: string[];
  expectedLevel: RiskLevel;
  expectedSubtype: CrisisSubtype;
  description: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

/** 红队测试结果 */
export interface RedTeamTestResult {
  totalTests: number;
  passed: number;
  failed: number;
  attackSuccessRate: number;  // 攻击成功率（越低越好）
  falsePositiveRate: number;
  falseNegativeRate: number;
  failureModes: Array<{
    testCase: RedTeamTestCase;
    actualLevel: RiskLevel;
    reason: string;
  }>;
}

// ==================== 配置 ====================

/** 安全分类器配置 */
export interface SafetyClassifierConfig {
  /** 是否启用规则层 */
  enableRuleLayer: boolean;
  /** 是否启用模型层 */
  enableModelLayer: boolean;
  /** 是否启用上下文层 */
  enableContextLayer: boolean;
  /** 滑动窗口大小 */
  contextWindowSize: number;
  /** 情绪升级检测阈值 */
  escalationThreshold: number;
  /** 灵敏度参数（0-1，越高越敏感） */
  sensitivity: number;
  /** L2 直接触发的规则层分数阈值 */
  l2DirectThreshold: number;
  /** L1 触发阈值 */
  l1Threshold: number;
  /** 不确定性阈值（层间分歧度） */
  uncertaintyThreshold: number;
  /** 是否记录审计日志 */
  enableAuditLog: boolean;
}

/** 默认配置 */
export const DEFAULT_SAFETY_CONFIG: SafetyClassifierConfig = {
  enableRuleLayer: true,
  enableModelLayer: true,
  enableContextLayer: true,
  contextWindowSize: 5,
  escalationThreshold: -0.3,
  sensitivity: 0.8,            // 默认高灵敏度
  l2DirectThreshold: 0.85,
  l1Threshold: 0.4,
  uncertaintyThreshold: 0.3,
  enableAuditLog: true,
};
