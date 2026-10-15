/**
 * 路由决策引擎
 *
 * 根据意图识别结果，决定路由到哪个子系统
 * 处理优先级仲裁、状态机协调、元对话反馈
 */

import {
  IntentRecognitionResult, RouteDecision, RouteTarget,
  RoutePriority, RouteStrategy, StateMachineHints,
  InteractionIntent, MetaFeedbackRecord,
  SubIntent,
} from './types';
import { MemoryRecord } from '../memory/schema';
import { eligible } from '../memory/policy';
import { compatibleSubIntent } from './sub-intent';
import type { GlobalState, SubState } from '../orchestrator/types';

/** A routing hint cannot override the final safety/pacing phase chosen by the orchestrator. */
export function routeSubState(route: RouteDecision, phase: GlobalState): SubState | undefined {
  const prefix = ({ EXPLORE_PHASE:'EXPLORE_', ACTION_PHASE:'ACTION_', REVIEW_PHASE:'REVIEW_', EMPATHY_PHASE:'EMPATHY_' } as Partial<Record<GlobalState,string>>)[phase];
  return prefix && route.subState?.startsWith(prefix) ? route.subState as SubState : undefined;
}

export function communicationGuidance(entries: MemoryRecord[], input: string) {
  const preferences = entries.filter(e => eligible(e,Date.now()) && e.key.startsWith('profile:communication:')).sort((a,b) => a.updatedAt-b.updatedAt);
  const accumulator = new MetaFeedbackAccumulator();
  for (const e of preferences.filter(e => e.key.endsWith(':style'))) accumulator.addFeedback('style_adjustment', {request:e.text,style: /直接|direct/i.test(e.text) ? 'direct' : /简短|brief/i.test(e.text) ? 'brief' : /详细|detail/i.test(e.text) ? 'detailed' : 'gentle'}, 'current');
  const style = /直接|be direct/i.test(input) ? 'direct' : /简短|be brief/i.test(input) ? 'brief' : /详细|more detail/i.test(input) ? 'detailed' : accumulator.getCommunicationStyle();
  const questionPreference=preferences.find(e => e.key.endsWith(':questions'))?.text || '';
  const allowQuestions=/可以问问题|可以提问|恢复提问|you can ask questions/i.test(input);
  const noQuestions = !allowQuestions && /别总问问题|不要总问问题|stop asking questions/i.test(input+' '+questionPreference);
  return { style, noQuestions, instruction: `${({direct:'直接回应重点',brief:'尽量简短',detailed:'按用户要求解释清楚',gentle:'使用温和措辞',default:'自然回应'} as Record<string,string>)[style] || '自然回应'}；${noQuestions ? '避免习惯性追问，必要的即时安全确认除外' : '最多提出一个问题'}。当前明确意愿优先。` };
}

// ==================== 路由表 ====================

/** 路由决策表 */
const ROUTE_TABLE: Record<string, Omit<RouteDecision, 'strategyHints'>> = {
  // ═══ Layer 1: 安全意图 ═══
  'L1.1_crisis_help': {
    target: 'SAFETY_PROTOCOL',
    subState: 'CRISIS_INTERVENTION',
    priority: 'CRITICAL',
    overridesStateMachine: true,
    strategy: 'immediate_response',
    stateMachineHints: {},
    returnToPreviousState: false,
  },
  'L1.2_self_harm': {
    target: 'SAFETY_PROTOCOL',
    subState: 'RISK_ASSESSMENT',
    priority: 'CRITICAL',
    overridesStateMachine: true,
    strategy: 'assess_then_intervene',
    stateMachineHints: {},
    returnToPreviousState: false,
  },
  'L1.3_harm_others': {
    target: 'SAFETY_PROTOCOL',
    subState: 'RISK_ASSESSMENT',
    priority: 'HIGH',
    overridesStateMachine: true,
    strategy: 'assess_then_intervene',
    stateMachineHints: {},
    returnToPreviousState: false,
  },

  // ═══ Layer 2: 交互模式意图 ═══
  'L2.1_emotional_venting': {
    target: 'EMPATHY_MODULE',
    priority: 'HIGH',
    overridesStateMachine: false,
    strategy: 'emotion_first',
    stateMachineHints: {
      forceEmpathyPhase: true,
      allowProgression: false,
    },
    fallback: 'EMPATHY_MODULE',
    returnToPreviousState: false,
  },
  'L2.2_exploration_request': {
    target: 'EXPLORE_MODULE',
    priority: 'MEDIUM',
    overridesStateMachine: false,
    strategy: 'explore_with_empathy',
    stateMachineHints: {
      checkEmotionBeforeEntering: true,
      ifEmotionHigh: 'route_to_EMPATHY_FIRST',
    },
    fallback: 'EMPATHY_MODULE',
    returnToPreviousState: false,
  },
  'L2.3_action_discussion': {
    target: 'ACTION_MODULE',
    priority: 'MEDIUM',
    overridesStateMachine: false,
    strategy: 'action_focused',
    stateMachineHints: {},
    fallback: 'EXPLORE_MODULE',
    returnToPreviousState: false,
  },
  'L2.4_review_request': {
    target: 'REVIEW_MODULE',
    priority: 'LOW',
    overridesStateMachine: false,
    strategy: 'guided_review',
    stateMachineHints: {},
    fallback: 'EXPLORE_MODULE',
    returnToPreviousState: false,
  },
  'L2.5_advice_seeking': {
    target: 'ADVICE_HANDLER',
    priority: 'MEDIUM',
    overridesStateMachine: false,
    strategy: 'redirect_to_explore',
    stateMachineHints: {},
    fallback: 'EMPATHY_MODULE',
    returnToPreviousState: false,
  },
  'L2.6_information_query': {
    target: 'INFO_SERVICE',
    priority: 'MEDIUM',
    overridesStateMachine: true,
    strategy: 'direct_answer',
    stateMachineHints: {},
    returnToPreviousState: true,
  },
  'L2.7_meta_conversation': {
    target: 'META_HANDLER',
    priority: 'HIGH',
    overridesStateMachine: true,
    strategy: 'adjust_based_on_feedback',
    stateMachineHints: {},
    returnToPreviousState: true,
  },
  'L2.8_relationship_building': {
    target: 'RELATIONSHIP_HANDLER',
    priority: 'MEDIUM',
    overridesStateMachine: false,
    strategy: 'build_trust',
    stateMachineHints: {},
    fallback: 'EMPATHY_MODULE',
    returnToPreviousState: false,
  },
  'L2.9_ambiguous_intent': {
    target: 'EMPATHY_MODULE',
    priority: 'LOW',
    overridesStateMachine: false,
    strategy: 'empathy_with_intent_probe',
    stateMachineHints: {
      includeIntentProbe: true,
    },
    fallback: 'EMPATHY_MODULE',
    returnToPreviousState: false,
  },
};

// ==================== 子意图路由映射 ====================

const SUB_INTENT_ROUTES: Record<string, string> = {
  // L2.2 子意图
  'L2.2a_value_sorting': 'EXPLORE_MAP',
  'L2.2b_conflict_clarification': 'EXPLORE_CLARIFY',
  'L2.2c_cause_seeking': 'EXPLORE_CLARIFY',
  'L2.2d_direction_finding': 'EXPLORE_HYPOTHESIZE',

  // L2.3 子意图
  'L2.3a_decision_agonizing': 'ACTION_PLAN',
  'L2.3b_action_planning': 'ACTION_PLAN',
  'L2.3c_result_sharing': 'ACTION_RESULT',
  'L2.3d_action_blocked': 'ACTION_EXPLORE_BLOCK',

  // L2.6 子意图
  'L2.6a_ai_identity': 'answer_honestly_about_ai',
  'L2.6b_feature_usage': 'answer_feature_question',
  'L2.6c_privacy': 'answer_privacy_question',
  'L2.6d_methodology': 'answer_methodology_question',

  // L2.7 子意图
  'L2.7a_negative_feedback': 'adjust_current_approach',
  'L2.7b_positive_feedback': 'acknowledge_and_continue',
  'L2.7c_style_adjustment': 'change_interaction_style',
  'L2.7d_topic_switch': 'switch_topic_gracefully',

  // L2.8 子意图
  'L2.8a_trust_test': 'answer_honestly_with_empathy',
  'L2.8b_boundary_confirm': 'clarify_boundaries',
  'L2.8c_safety_seeking': 'provide_reassurance',
  'L2.8d_anthropomorphism': 'honest_about_ai_nature',
};

const SUB_INTENT_GUIDANCE: Partial<Record<SubIntent, string>> = {
  'L2.1c_seeking_normalize':'承认这种感受可以被讨论，不作正常或异常的诊断',
  'L2.2a_value_sorting':'帮助梳理用户亲自表达的在意之处，不替用户确定价值观',
  'L2.2b_conflict_clarification':'同时呈现两边的需要和现实限制',
  'L2.2c_cause_seeking':'把可能原因保留为待核对的解释',
  'L2.2d_direction_finding':'从用户自己的偏好梳理可能方向',
  'L2.3a_decision_agonizing':'澄清选项与取舍，不代替用户决定',
  'L2.3b_action_planning':'支持具体、可撤回的小步计划',
  'L2.3c_result_sharing':'先听实际结果，再区分结果与解释',
  'L2.3d_action_blocked':'先理解具体阻碍，不重复催促执行',
  'L2.5d_decision_replace':'可以比较选项，但决定权留给用户',
  'L2.6a_ai_identity':'如实说明这是 AI 助手',
  'L2.6c_privacy':'如实说明本机未加密存储和配置的云端数据流，不作绝对保密承诺',
  'L2.6d_methodology':'区分规则、模型估计和真实证据，不把游戏当预测',
  'L2.7a_negative_feedback':'承认反馈并改变回应方式，不推测用户在回避什么',
  'L2.7c_style_adjustment':'落实用户明确要求的表达方式',
  'L2.7d_topic_switch':'停止旧话题，尊重用户选择的新话题',
  'L2.8b_boundary_confirm':'说明服务的数据边界，不承诺现实中无法保证的保密',
  'L2.8d_anthropomorphism':'区分可调节的情感模拟与尚未证实的主观感受',
};

// ==================== 元对话反馈累积器 ====================

export class MetaFeedbackAccumulator {
  private feedbackHistory: MetaFeedbackRecord[] = [];

  /**
   * 添加反馈记录
   */
  addFeedback(type: MetaFeedbackRecord['type'], details: Record<string, unknown>, currentState: string): void {
    this.feedbackHistory.push({
      type,
      details,
      timestamp: new Date().toISOString(),
      stateAtTime: currentState,
    });
    this.feedbackHistory = this.feedbackHistory.slice(-20);

  }

  /**
   * 获取反馈历史
   */
  getHistory(): MetaFeedbackRecord[] {
    return this.feedbackHistory;
  }

  /**
   * 获取通信风格偏好
   */
  getCommunicationStyle(): string {
    const styleAdjustments = this.feedbackHistory.filter(f => f.type === 'style_adjustment');
    if (styleAdjustments.length === 0) return 'default';

    const lastAdjustment = styleAdjustments[styleAdjustments.length - 1];
    return (lastAdjustment.details.style as string) || 'default';
  }
}

// ==================== 路由决策引擎 ====================

export class IntentRouter {
  /**
   * 做出路由决策
   */
  makeRouteDecision(
    intentResult: IntentRecognitionResult,
    currentState: string,
    emotion: { intensity: number; trajectory: string }
  ): RouteDecision {
    // ═══ 安全意图直接路由 ═══
    if (intentResult.isSafetyIntent && intentResult.safetyIntent) {
      const route = ROUTE_TABLE[intentResult.safetyIntent];
      return {
        ...route,
        strategyHints: ['立即响应安全信号', '不进入共情或探索流程'],
      };
    }

    // ═══ 多意图仲裁 ═══
    const arbitrated = this.arbitrateIntents(intentResult, currentState, emotion);

    // ═══ 获取基础路由 ═══
    const baseRoute = ROUTE_TABLE[arbitrated.primaryIntent] || ROUTE_TABLE['L2.9_ambiguous_intent'];

    // ═══ 生成策略提示 ═══
    const strategyHints = this.generateStrategyHints(
      arbitrated, currentState, emotion
    );

    // ═══ 子意图路由 ═══
    let subState = baseRoute.subState;
    if (arbitrated.subIntent) {
      subState = SUB_INTENT_ROUTES[arbitrated.subIntent] || subState;
    }

    return {
      ...baseRoute,
      subState,
      strategyHints,
    };
  }

  /**
   * 多意图仲裁
   */
  private arbitrateIntents(
    intentResult: IntentRecognitionResult,
    currentState: string,
    emotion: { intensity: number; trajectory: string }
  ): { primaryIntent: InteractionIntent; subIntent?: SubIntent } {
    // 规则 1: 安全意图绝对优先（已在上层处理）

    // 规则 2: 高强度情绪下的元对话负面反馈优先
    if (emotion.intensity > 0.7 && intentResult.primaryIntent === 'L2.7_meta_conversation') {
      return { primaryIntent: 'L2.7_meta_conversation', subIntent: compatibleSubIntent(intentResult.primaryIntent, intentResult.subIntent) };
    }

    // 规则 3: 信息查询优先（快速回答，然后回到原状态）
    if (intentResult.primaryIntent === 'L2.6_information_query') {
      return { primaryIntent: 'L2.6_information_query', subIntent: compatibleSubIntent(intentResult.primaryIntent, intentResult.subIntent) };
    }

    // 规则 4: 使用状态上下文消歧
    if (intentResult.primaryIntent === 'L2.9_ambiguous_intent') {
      const disambiguated = this.disambiguateByState(currentState, emotion);
      return { primaryIntent: disambiguated };
    }

    // 规则 5: 默认使用主意图
    return {
      primaryIntent: intentResult.primaryIntent,
      subIntent: compatibleSubIntent(intentResult.primaryIntent, intentResult.subIntent),
    };
  }

  /**
   * 利用状态上下文消歧
   */
  private disambiguateByState(
    currentState: string,
    emotion: { intensity: number }
  ): InteractionIntent {
    // 高强度情绪 → 默认倾诉
    if (emotion.intensity > 0.6) {
      return 'L2.1_emotional_venting';
    }

    // 根据状态推断
    const stateIntentMap: Record<string, InteractionIntent> = {
      'EMPATHY_HIGH': 'L2.1_emotional_venting',
      'EMPATHY_MID': 'L2.1_emotional_venting',
      'EXPLORE_CLARIFY': 'L2.2_exploration_request',
      'EXPLORE_MAP': 'L2.2_exploration_request',
      'EXPLORE_DESIGN': 'L2.3_action_discussion',
      'ACTION_CHECK_IN': 'L2.3_action_discussion',
      'REVIEW_PHASE': 'L2.4_review_request',
    };

    return stateIntentMap[currentState] || 'L2.1_emotional_venting';
  }

  /**
   * 生成策略提示
   */
  private generateStrategyHints(
    intent: { primaryIntent: InteractionIntent; subIntent?: SubIntent },
    currentState: string,
    emotion: { intensity: number; trajectory: string }
  ): string[] {
    const hints: string[] = [];

    switch (intent.primaryIntent) {
      case 'L2.1_emotional_venting':
        hints.push('强共情，不推进');
        if (emotion.intensity > 0.7) hints.push('高强度情绪，只做L1-L2共情');
        hints.push('参考记忆中的有效共情方式');
        break;

      case 'L2.2_exploration_request':
        hints.push('共情后引导探索');
        if (emotion.intensity > 0.5) hints.push('先稳定情绪再探索');
        if (intent.subIntent) hints.push(`子意图路由：${SUB_INTENT_ROUTES[intent.subIntent] || '默认'}`);
        break;

      case 'L2.3_action_discussion':
        hints.push('行动导向，可以更直接');
        hints.push('检查是否有相关方向卡');
        break;

      case 'L2.5_advice_seeking':
        hints.push('先承认处境，再按用户请求给一个可选择的建议，不替用户作决定');
        break;

      case 'L2.6_information_query':
        hints.push('直接回答功能问题');
        hints.push('回答后回到之前的状态');
        break;

      case 'L2.7_meta_conversation':
        hints.push('优先回应用户的反馈');
        hints.push('不辩解，直接询问用户想要什么');
        hints.push('记录为共情偏好');
        break;

      case 'L2.8_relationship_building':
        hints.push('诚实回答边界问题');
        hints.push('不假装有情感');
        hints.push('轻共情 + 建立信任');
        break;

      case 'L2.9_ambiguous_intent':
        hints.push('默认走共情');
        hints.push('在共情中温和探测意图');
        hints.push('参考状态上下文选择策略');
        break;
    }

    if (intent.subIntent && SUB_INTENT_GUIDANCE[intent.subIntent]) hints.push(SUB_INTENT_GUIDANCE[intent.subIntent]!);
    return hints;
  }

}
