/**
 * 对话状态机与流程编排器 - 统一导出
 *
 * 模块架构：
 * ┌─────────────────────────────────────────────────────────┐
 * │               ConversationOrchestrator                    │
 * │                  (流程编排器主类)                          │
 * ├─────────────────────────────────────────────────────────┤
 * │  ConversationStateMachine │ JourneyStageTracker          │
 * │  (状态机+转换规则)         │ (旅程阶段追踪)               │
 * ├─────────────────────────────────────────────────────────┤
 * │                      types                                │
 * │                  (数据模型定义)                            │
 * └─────────────────────────────────────────────────────────┘
 */

// 数据类型
export * from './types';

// 状态机
export { ConversationStateMachine } from './state-machine';

// 旅程阶段追踪
export { JourneyStageTracker } from './journey-tracker';

// 编排器
export { ConversationOrchestrator } from './orchestrator';
