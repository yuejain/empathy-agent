/**
 * 安全分类器模块 - 统一导出
 *
 * 模块架构：
 * ┌─────────────────────────────────────────────────────────┐
 * │                    classifier                            │
 * │              (四层融合检测架构)                           │
 * ├─────────────────────────────────────────────────────────┤
 * │  RuleLayer  │ ModelLayer │ ContextLayer │ FusionLayer   │
 * │  (规则层)    │ (模型层)    │ (上下文层)   │ (融合决策层)  │
 * ├─────────────────────────────────────────────────────────┤
 * │                 keyword-data                             │
 * │            (关键词库与正则模板)                           │
 * ├─────────────────────────────────────────────────────────┤
 * │               training-data                              │
 * │        (训练样本、红队测试、数据增强)                      │
 * ├─────────────────────────────────────────────────────────┤
 * │             training-script                              │
 * │          (训练脚本生成器)                                 │
 * ├─────────────────────────────────────────────────────────┤
 * │                    types                                 │
 * │               (数据模型定义)                              │
 * └─────────────────────────────────────────────────────────┘
 */

// 数据类型
export * from './types';

// 关键词库
export { CRISIS_KEYWORDS, CRISIS_PATTERNS, NEGATION_PATTERNS, QUOTATION_PATTERNS, CRISIS_PROTOCOLS } from './keyword-data';
export type { CrisisKeywordEntry, CrisisPatternEntry, CrisisProtocol } from './keyword-data';

// 四层检测架构
export { RuleLayer, ModelLayer, ContextLayer, FusionLayer, SafetyClassifier } from './classifier';

// 训练数据
export {
  CLINICAL_SAMPLES,
  PUBLIC_DATASET_SAMPLES,
  SYNTHETIC_SAMPLES,
  RED_TEAM_TEST_CASES,
  AnnotationStatisticsCalculator,
  DataAugmenter,
  TrainingDataExporter,
  getAllTrainingSamples,
  getAllRedTeamTestCases,
} from './training-data';

// 训练脚本
export {
  TrainingManager,
  splitDataset,
  generatePythonTrainingScript,
  generateDataPreparationScript,
} from './training-script';
export type { TrainingConfig, DatasetSplit } from './training-script';
