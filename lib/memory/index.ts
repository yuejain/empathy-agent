/**
 * 记忆模块 - 统一导出
 *
 * 模块架构：
 * ┌─────────────────────────────────────────────────────────┐
 * │                    memory-pipeline                       │
 * │                   (实时链路编排)                          │
 * ├─────────────────────────────────────────────────────────┤
 * │  retrieval-engine    │  memory-store  │ session-summary  │
 * │  (四路检索+重排+压缩) │  (CRUD+衰减)   │ (会话摘要生成)    │
 * ├─────────────────────────────────────────────────────────┤
 * │                     types                                │
 * │                 (数据模型定义)                             │
 * └─────────────────────────────────────────────────────────┘
 */

// 数据模型
export * from './types';

// 记忆存储管理器
export { MemoryStore, MemoryDecayModel, MemoryRuleEngine, MemoryWriteEvaluator, MemoryConsistencyChecker } from './memory-store';

// 记忆检索引擎
export {
  MemoryRetrievalEngine,
  VectorRetriever,
  GraphRetriever,
  StructuredRetriever,
  GraphRAGRetriever,
  LLMLinguaCompressor,
  MockEmbeddingModel,
  MockCrossEncoderModel,
} from './retrieval-engine';

export type { EmbeddingModel, CrossEncoderModel } from './retrieval-engine';

// 会话摘要生成器
export { SessionSummaryGenerator } from './session-summary';
export type { ConversationTurn, SessionSummaryResult } from './session-summary';

// 记忆管线
export { MemoryPipeline, SafetyClassifier } from './memory-pipeline';
export type { MemoryPipelineConfig, PipelineContext, PipelineResult } from './memory-pipeline';

// 安全分类器模块（从 safety-classifier 导出）
export {
  SafetyClassifier as AdvancedSafetyClassifier,
  RuleLayer,
  ModelLayer,
  ContextLayer,
  FusionLayer,
  TrainingManager,
  getAllTrainingSamples,
  getAllRedTeamTestCases,
  AnnotationStatisticsCalculator,
  DataAugmenter,
  TrainingDataExporter,
  CRISIS_KEYWORDS,
  CRISIS_PATTERNS,
  CRISIS_PROTOCOLS,
} from '../safety-classifier';

export type {
  RiskLevel,
  CrisisSubtype,
  SafetyClassificationResult,
  SafetyContextTurn,
  SafetyStateMemory,
  SafetyClassifierConfig,
  RuleLayerOutput,
  ModelLayerOutput,
  ContextLayerOutput,
  FusionDecisionOutput,
  MatchedKeyword,
  MatchedPattern,
  EmotionTrend,
  TopicEvolution,
  SafetyTrainingSample,
  RedTeamTestCase,
  RedTeamTestResult,
  TrainingConfig,
  DatasetSplit,
} from '../safety-classifier';
