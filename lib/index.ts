/**
 * 陪伴Agent - 核心库统一导出
 *
 * 模块架构：
 * ┌─────────────────────────────────────────────────────────┐
 * │                   orchestrator                           │
 * │              (对话状态机与流程编排器)                      │
 * │                    ↕          ↕                          │
 * │    intent          safety-classifier         memory      │
 * │    (意图识别)       (安全分类器)              (记忆系统)   │
 * │                    ↕          ↕                          │
 * │    tarot           empathy-decision    emotion-recognition│
 * │    (塔罗破冰)      (共情决策)           (情感识别)        │
 * ├─────────────────────────────────────────────────────────┤
 * │    emotion-tags    emotion-tracker       safety          │
 * │    (情感标签)      (情绪追踪)            (安全机制)        │
 * └─────────────────────────────────────────────────────────┘
 */

// ==================== 基础模块 ====================
export * from './emotion-tags';
export * from './emotion-recognition';
export * from './emotion-tracker';
export * from './empathy-decision';
export * from './safety';

// ==================== 子系统模块 ====================
export * from './memory';
export * from './safety-classifier';
export * from './tarot';
export * from './orchestrator';
export * from './intent';

// ==================== 同名符号消歧 ====================
// 多个子模块导出了同名成员，以下显式指定以主实现为准
export type { EmotionTrend, EmotionState } from './emotion-tracker';
export type { EmpathyLevel } from './empathy-decision';
export { SafetyClassifier } from './safety-classifier';
