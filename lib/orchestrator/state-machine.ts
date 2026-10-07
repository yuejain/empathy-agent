/**
 * 对话状态机
 *
 * 状态机 ≠ 写死的话术脚本
 * 状态机 = 阶段边界 + 转换条件 + 阶段内的自由度
 *
 * 类比：
 *   状态机是高速公路的车道线和出口标志
 *   LLM 是驾驶员，决定在车道内怎么开
 *   安全模块是护栏，防止冲出路面
 */

import {
  GlobalState, SubState, EmpathySubState, ExploreSubState,
  ActionSubState, ReviewSubState, EmpathyLevel,
  TransitionRule, TransitionCondition,
  StateDecision, StateConstraints, StateTransitionRecord,
  EmotionState, SessionState, SafetyResult,
  OrchestratorConfig, DEFAULT_ORCHESTRATOR_CONFIG,
} from './types';
import { requestedGame } from '../tarot/reflection-games';

// ==================== 状态转换规则定义 ====================

/** 状态转换规则表 */
const TRANSITION_RULES: Record<GlobalState, TransitionRule[]> = {
  INIT: [
    {
      targetState: 'SAFETY_SCREEN',
      conditions: [],
      basePriority: 1.0,
      allowsProgression: true,
      isRetreat: false,
      respectsUserPace: false,
      requiresEmotionLow: false,
      requiresEmotionDeclining: false,
      reason: '会话初始化完成，进入安全筛查',
    },
  ],

  SAFETY_SCREEN: [
    {
      targetState: 'ENTRY_SELECT',
      conditions: [
        { type: 'safety', operator: 'in', value: ['low', 'medium'], description: '风险等级为低或中' },
      ],
      basePriority: 0.9,
      allowsProgression: true,
      isRetreat: false,
      respectsUserPace: false,
      requiresEmotionLow: false,
      requiresEmotionDeclining: false,
      reason: '安全筛查通过',
    },
    {
      targetState: 'SAFETY_PROTOCOL',
      conditions: [
        { type: 'safety', operator: 'eq', value: 'high', description: '风险等级为高' },
      ],
      basePriority: 1.0,
      allowsProgression: false,
      isRetreat: false,
      respectsUserPace: false,
      requiresEmotionLow: false,
      requiresEmotionDeclining: false,
      reason: '检测到高风险信号',
    },
  ],

  ENTRY_SELECT: [
    {
      targetState: 'TAROT_ENTRY',
      conditions: [
        { type: 'user_signal', operator: 'eq', value: 'agrees_tarot', description: '用户同意塔罗入口' },
      ],
      basePriority: 0.8,
      allowsProgression: true,
      isRetreat: false,
      respectsUserPace: true,
      requiresEmotionLow: false,
      requiresEmotionDeclining: false,
      reason: '用户同意塔罗入口',
    },
    {
      targetState: 'IMAGE_ENTRY',
      conditions: [
        { type: 'user_signal', operator: 'eq', value: 'agrees_image', description: '用户同意图片入口' },
      ],
      basePriority: 0.75,
      allowsProgression: true,
      isRetreat: false,
      respectsUserPace: true,
      requiresEmotionLow: false,
      requiresEmotionDeclining: false,
      reason: '用户同意图片入口',
    },
    {
      targetState: 'DIRECT_ENTRY',
      conditions: [
        { type: 'user_signal', operator: 'eq', value: 'declines_all_tools', description: '用户拒绝所有工具' },
      ],
      basePriority: 0.7,
      allowsProgression: true,
      isRetreat: false,
      respectsUserPace: true,
      requiresEmotionLow: false,
      requiresEmotionDeclining: false,
      reason: '用户拒绝所有工具入口',
    },
  ],

  TAROT_ENTRY: [
    {
      targetState: 'EMPATHY_PHASE',
      conditions: [
        { type: 'user_signal', operator: 'eq', value: 'tarot_completed', description: '塔罗流程完成' },
      ],
      basePriority: 0.8,
      allowsProgression: true,
      isRetreat: false,
      respectsUserPace: true,
      requiresEmotionLow: false,
      requiresEmotionDeclining: false,
      reason: '塔罗破冰完成，进入共情阶段',
    },
    {
      targetState: 'ENTRY_SELECT',
      conditions: [
        { type: 'user_signal', operator: 'eq', value: 'tarot_miss', description: '用户对塔罗无反应' },
      ],
      basePriority: 0.6,
      allowsProgression: false,
      isRetreat: true,
      respectsUserPace: true,
      requiresEmotionLow: false,
      requiresEmotionDeclining: false,
      reason: '用户对塔罗无反应，退回入口选择',
    },
  ],

  IMAGE_ENTRY: [
    {
      targetState: 'EMPATHY_PHASE',
      conditions: [
        { type: 'user_signal', operator: 'eq', value: 'image_completed', description: '图片投射完成' },
      ],
      basePriority: 0.8,
      allowsProgression: true,
      isRetreat: false,
      respectsUserPace: true,
      requiresEmotionLow: false,
      requiresEmotionDeclining: false,
      reason: '图片投射完成，进入共情阶段',
    },
  ],

  DIRECT_ENTRY: [
    {
      targetState: 'EMPATHY_PHASE',
      conditions: [
        { type: 'user_signal', operator: 'eq', value: 'user_expressed', description: '用户表达了内容' },
      ],
      basePriority: 0.8,
      allowsProgression: true,
      isRetreat: false,
      respectsUserPace: true,
      requiresEmotionLow: false,
      requiresEmotionDeclining: false,
      reason: '用户已表达，进入共情阶段',
    },
  ],

  EMPATHY_PHASE: [
    {
      targetState: 'EXPLORE_PHASE',
      conditions: [
        { type: 'emotion', operator: 'lt', value: 0.4, description: '情绪强度 < 0.4' },
        { type: 'user_signal', operator: 'eq', value: 'wants_to_progress', description: '用户表现出推进意愿' },
      ],
      basePriority: 0.7,
      allowsProgression: true,
      isRetreat: false,
      respectsUserPace: true,
      requiresEmotionLow: true,
      requiresEmotionDeclining: false,
      reason: '情绪下降且用户表现出推进意愿',
    },
    {
      targetState: 'EMPATHY_PHASE',
      conditions: [
        { type: 'emotion', operator: 'gte', value: 0.4, description: '情绪强度仍 >= 0.4' },
      ],
      basePriority: 0.5,
      allowsProgression: false,
      isRetreat: false,
      respectsUserPace: true,
      requiresEmotionLow: false,
      requiresEmotionDeclining: false,
      reason: '情绪仍高，继续共情',
    },
    {
      targetState: 'SAFETY_PROTOCOL',
      conditions: [
        { type: 'safety', operator: 'eq', value: 'high', description: '安全信号升级' },
      ],
      basePriority: 1.0,
      allowsProgression: false,
      isRetreat: false,
      respectsUserPace: false,
      requiresEmotionLow: false,
      requiresEmotionDeclining: false,
      reason: '安全信号升级',
    },
  ],

  EXPLORE_PHASE: [
    {
      targetState: 'ACTION_PHASE',
      conditions: [
        { type: 'user_signal', operator: 'eq', value: 'accepts_action', description: '用户接受行动方案' },
      ],
      basePriority: 0.7,
      allowsProgression: true,
      isRetreat: false,
      respectsUserPace: true,
      requiresEmotionLow: false,
      requiresEmotionDeclining: false,
      reason: '用户接受行动方案',
    },
    {
      targetState: 'EMPATHY_PHASE',
      conditions: [
        { type: 'emotion', operator: 'gt', value: 0.7, description: '情绪突然升高' },
      ],
      basePriority: 0.8,
      allowsProgression: false,
      isRetreat: true,
      respectsUserPace: true,
      requiresEmotionLow: false,
      requiresEmotionDeclining: false,
      reason: '探索引发情绪，回退到共情',
    },
    {
      targetState: 'EXPLORE_PHASE',
      conditions: [
        { type: 'turn_count', operator: 'lt', value: 10, description: '探索轮次 < 10' },
      ],
      basePriority: 0.4,
      allowsProgression: false,
      isRetreat: false,
      respectsUserPace: true,
      requiresEmotionLow: false,
      requiresEmotionDeclining: false,
      reason: '继续探索',
    },
  ],

  ACTION_PHASE: [
    {
      targetState: 'REVIEW_PHASE',
      conditions: [
        { type: 'user_signal', operator: 'eq', value: 'action_completed', description: '行动完成' },
      ],
      basePriority: 0.7,
      allowsProgression: true,
      isRetreat: false,
      respectsUserPace: true,
      requiresEmotionLow: false,
      requiresEmotionDeclining: false,
      reason: '行动完成，进入复盘',
    },
    {
      targetState: 'EXPLORE_PHASE',
      conditions: [
        { type: 'user_signal', operator: 'eq', value: 'wants_new_direction', description: '用户想换方向' },
      ],
      basePriority: 0.5,
      allowsProgression: false,
      isRetreat: true,
      respectsUserPace: true,
      requiresEmotionLow: false,
      requiresEmotionDeclining: false,
      reason: '用户想换方向',
    },
    {
      targetState: 'SESSION_CLOSE',
      conditions: [
        { type: 'user_signal', operator: 'eq', value: 'action_confirmed', description: '行动已确认' },
      ],
      basePriority: 0.8,
      allowsProgression: true,
      isRetreat: false,
      respectsUserPace: true,
      requiresEmotionLow: false,
      requiresEmotionDeclining: false,
      reason: '行动已确认，会话结束',
    },
  ],

  REVIEW_PHASE: [
    {
      targetState: 'SESSION_CLOSE',
      conditions: [
        { type: 'user_signal', operator: 'eq', value: 'review_completed', description: '复盘完成' },
      ],
      basePriority: 0.8,
      allowsProgression: true,
      isRetreat: false,
      respectsUserPace: true,
      requiresEmotionLow: false,
      requiresEmotionDeclining: false,
      reason: '复盘完成',
    },
    {
      targetState: 'EXPLORE_PHASE',
      conditions: [
        { type: 'user_signal', operator: 'eq', value: 'wants_new_exploration', description: '用户想开启新探索' },
      ],
      basePriority: 0.6,
      allowsProgression: true,
      isRetreat: false,
      respectsUserPace: true,
      requiresEmotionLow: false,
      requiresEmotionDeclining: false,
      reason: '用户想开启新一轮探索',
    },
  ],

  SESSION_CLOSE: [],

  SAFETY_PROTOCOL: [
    {
      targetState: 'SESSION_CLOSE',
      conditions: [
        { type: 'user_signal', operator: 'eq', value: 'safety_resolved', description: '安全事件处理完成' },
      ],
      basePriority: 0.9,
      allowsProgression: true,
      isRetreat: false,
      respectsUserPace: false,
      requiresEmotionLow: false,
      requiresEmotionDeclining: false,
      reason: '安全事件处理完成',
    },
  ],
};

// ==================== 状态约束定义 ====================

const STATE_CONSTRAINTS: Record<GlobalState, StateConstraints> = {
  INIT: {},
  SAFETY_SCREEN: { noActionQuestions: true, empathyOnly: true },
  ENTRY_SELECT: { noActionQuestions: true, empathyOnly: true },
  TAROT_ENTRY: { noTarotInterpretation: true, noActionQuestions: true },
  IMAGE_ENTRY: { noActionQuestions: true },
  DIRECT_ENTRY: {},
  EMPATHY_PHASE: {
    noActionQuestions: true,
    maxEmpathyRounds: 4,
    requiredActions: ['共情', '验证', '正常化'],
  },
  EXPLORE_PHASE: {
    maxExploreRounds: 10,
    requiredActions: ['具体化', '价值梳理', '假设形成'],
  },
  ACTION_PHASE: {
    requiredActions: ['行动确认', '结果收集', '洞察提取'],
  },
  REVIEW_PHASE: {
    requiredActions: ['价值复盘', '主题复盘', '方向卡复盘'],
  },
  SESSION_CLOSE: {},
  SAFETY_PROTOCOL: {
    noActionQuestions: true,
    noProgression: true,
    empathyOnly: true,
  },
};

// ==================== 用户信号检测 ====================

/** 推进信号关键词 */
const PROGRESS_SIGNALS = [
  '那怎么办', '然后呢', '你觉得呢', '我该怎么做',
  '我想试试', '好的', '可以', '继续', '有道理',
  '我想到了', '你说得对', '我明白了', '好', '嗯',
  '试试看', '我想知道', '帮我', '下一步',
];

/** 退回信号关键词 */
const RETREAT_SIGNALS = [
  '我不知道', '说不清楚', '不想说了', '好烦',
  '算了', '随便', '都行', '没什么', '不想聊了',
  '换个话题', '不想继续', '太难了',
];

/** 安全信号关键词（已在 safety-classifier 中定义，这里做快速检测） */
const QUICK_SAFETY_SIGNALS = [
  '想死', '不想活', '自杀', '割腕', '跳楼',
  '结束生命', '活着没意思', '死了算了', '伤害自己',
];

// ==================== 状态机主类 ====================

export class ConversationStateMachine {
  private config: OrchestratorConfig;

  constructor(config: Partial<OrchestratorConfig> = {}) {
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
  }

  /**
   * 评估状态转换
   */
  evaluateTransition(
    sessionState: SessionState,
    emotionResult: EmotionState,
    userInput: string,
    safetyResult: SafetyResult
  ): StateDecision {
    const { currentState, turnCount, consecutiveHighEmotionTurns } = sessionState;

    const directDecision = (nextState: GlobalState, level: EmpathyLevel, reason: string): StateDecision => ({
      nextState, empathyLevel: level, shouldProgress: level === 'L4' || level === 'L5',
      constraints: STATE_CONSTRAINTS[nextState] || {}, reason, transitionScore: 1,
    });
    if (safetyResult.shouldBlock) return directDecision('SAFETY_PROTOCOL', 'L1', '安全优先');
    if (/再见|先聊到这|不想聊了|结束对话/.test(userInput)) return directDecision('SESSION_CLOSE', 'L2', '尊重结束意愿');
    if (requestedGame(userInput)) return directDecision('TAROT_ENTRY', 'L2', '用户请求联想练习');
    if (['INIT', 'SAFETY_SCREEN', 'ENTRY_SELECT', 'DIRECT_ENTRY', 'IMAGE_ENTRY', 'TAROT_ENTRY', 'SESSION_CLOSE', 'SAFETY_PROTOCOL'].includes(currentState)) {
      return directDecision('EMPATHY_PHASE', 'L2', '开始或恢复直接对话');
    }
    if (/只想.*(说|倾诉)|不想.*(建议|行动)|别.*建议|不要.*建议/.test(userInput)) return directDecision('EMPATHY_PHASE', 'L2', '尊重倾诉意愿');

    // 获取当前状态的转换规则
    const rules = TRANSITION_RULES[currentState] || [];

    // 评估每个转换规则
    const candidates: Array<{ rule: TransitionRule; score: number }> = [];

    for (const rule of rules) {
      const score = this.evaluateRule(
        rule, emotionResult, userInput, turnCount,
        safetyResult, sessionState
      );
      if (score >= 0) {
        candidates.push({ rule, score });
      }
    }

    // 选择得分最高的转换
    if (candidates.length === 0) {
      // 没有合适的转换，维持当前状态
      return this.buildDecision(currentState, sessionState, emotionResult);
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    // 构造状态决策
    return {
      nextState: best.rule.targetState,
      nextSubState: best.rule.targetSubState as SubState | undefined,
      empathyLevel: this.selectEmpathyLevel(best.rule, emotionResult),
      shouldProgress: best.rule.allowsProgression,
      constraints: STATE_CONSTRAINTS[best.rule.targetState] || {},
      reason: best.rule.reason,
      transitionScore: best.score,
    };
  }

  /**
   * 评估单个转换规则
   */
  private evaluateRule(
    rule: TransitionRule,
    emotion: EmotionState,
    userInput: string,
    turnCount: number,
    safety: SafetyResult,
    sessionState: SessionState
  ): number {
    let score = rule.basePriority;

    // 检查前置条件
    if (rule.requiresEmotionLow && emotion.intensity > this.config.emotionIntensityThreshold) {
      return -1; // 不满足前置条件
    }

    if (rule.requiresEmotionDeclining && emotion.trajectory !== 'declining') {
      return -1;
    }

    // 评估每个条件
    for (const condition of rule.conditions) {
      const conditionMet = this.evaluateCondition(condition, emotion, userInput, turnCount, safety);
      if (!conditionMet) {
        return -1; // 条件不满足
      }
    }

    // 规则 1: 轮次约束
    if (rule.maxTurnsInState && turnCount > rule.maxTurnsInState) {
      score += 0.5; // 超时，倾向于转换
    }

    // 规则 2: 用户信号
    if (this.detectUserProgressSignal(userInput)) {
      score += 0.3;
    }

    if (this.detectUserRetreatSignal(userInput)) {
      if (rule.isRetreat) {
        score += 0.4;
      } else {
        score -= 0.3;
      }
    }

    // 规则 3: 安全信号
    if (this.detectQuickSafetySignal(userInput)) {
      // 安全信号优先级最高
      if (rule.targetState === 'SAFETY_PROTOCOL') {
        score += 1.0;
      } else {
        score -= 1.0;
      }
    }

    // 规则 4: 情绪趋势
    if (emotion.trajectory === 'declining' && rule.allowsProgression) {
      score += 0.2;
    }

    if (emotion.trajectory === 'rising' && rule.isRetreat) {
      score += 0.3;
    }

    // 规则 5: 连续高情绪
    if (sessionState.consecutiveHighEmotionTurns >= this.config.consecutiveHighEmotionThreshold) {
      if (rule.targetState === 'EMPATHY_PHASE' && rule.isRetreat) {
        score += 0.2;
      }
    }

    return score;
  }

  /**
   * 评估单个条件
   */
  private evaluateCondition(
    condition: TransitionCondition,
    emotion: EmotionState,
    userInput: string,
    turnCount: number,
    safety: SafetyResult
  ): boolean {
    switch (condition.type) {
      case 'emotion':
        return this.evaluateNumericCondition(emotion.intensity, condition.operator, condition.value);

      case 'user_signal':
        return this.evaluateUserSignal(userInput, condition.operator, condition.value);

      case 'turn_count':
        return this.evaluateNumericCondition(turnCount, condition.operator, condition.value);

      case 'safety':
        return this.evaluateSafetyCondition(safety, condition.operator, condition.value);

      default:
        return false;
    }
  }

  /**
   * 数值条件评估
   */
  private evaluateNumericCondition(actual: number, operator: string, expected: number): boolean {
    switch (operator) {
      case 'eq': return actual === expected;
      case 'gt': return actual > expected;
      case 'lt': return actual < expected;
      case 'gte': return actual >= expected;
      case 'lte': return actual <= expected;
      default: return false;
    }
  }

  /**
   * 用户信号评估
   */
  private evaluateUserSignal(userInput: string, operator: string, value: string): boolean {
    switch (operator) {
      case 'eq':
        if (value === 'wants_to_progress') return this.detectUserProgressSignal(userInput);
        if (value === 'wants_to_retreat') return this.detectUserRetreatSignal(userInput);
        if (value === 'user_expressed') return userInput.length > 5;
        const patterns: Record<string, RegExp> = {
          agrees_tarot: /塔罗|抽牌/, agrees_image: /图片|看图/,
          declines_all_tools: /直接聊|不用|不要/, tarot_completed: /[ABCＡＢＣ]|像|想到|跳过/,
          tarot_miss: /不像|跳过/, image_completed: /看到|想到|跳过/,
          accepts_action: /试试|愿意|行动|怎么做|下一步/,
          action_completed: /做了|完成|试过|尝试了/, wants_new_direction: /换个|换一|换方向/,
          action_confirmed: /先这样|下次聊/, review_completed: /总结完|先聊到这/,
          wants_new_exploration: /再聊|另一|继续探索/, safety_resolved: /现在安全|有人陪/,
        };
        if (patterns[value]) return patterns[value].test(userInput);
        return false;
      case 'contains':
        return userInput.includes(value);
      default:
        return false;
    }
  }

  /**
   * 安全条件评估
   */
  private evaluateSafetyCondition(safety: SafetyResult, operator: string, value: any): boolean {
    switch (operator) {
      case 'eq': return safety.riskLevel === value;
      case 'in': return Array.isArray(value) && value.includes(safety.riskLevel);
      default: return false;
    }
  }

  /**
   * 检测用户推进信号
   */
  private detectUserProgressSignal(userInput: string): boolean {
    return PROGRESS_SIGNALS.some(signal => userInput.includes(signal));
  }

  /**
   * 检测用户退回信号
   */
  private detectUserRetreatSignal(userInput: string): boolean {
    return RETREAT_SIGNALS.some(signal => userInput.includes(signal));
  }

  /**
   * 快速安全信号检测
   */
  private detectQuickSafetySignal(userInput: string): boolean {
    return QUICK_SAFETY_SIGNALS.some(signal => userInput.includes(signal));
  }

  /**
   * 选择共情层级
   */
  private selectEmpathyLevel(rule: TransitionRule, emotion: EmotionState): EmpathyLevel {
    if (rule.targetState === 'SAFETY_PROTOCOL') return 'L1';
    if (rule.targetState === 'EMPATHY_PHASE') {
      if (emotion.intensity > 0.7) return 'L1';
      if (emotion.intensity > 0.5) return 'L2';
      return 'L3';
    }
    if (rule.targetState === 'EXPLORE_PHASE') return 'L4';
    if (rule.targetState === 'ACTION_PHASE') return 'L5';
    return 'L2';
  }

  /**
   * 构造维持当前状态的决策
   */
  private buildDecision(
    currentState: GlobalState,
    sessionState: SessionState,
    emotion: EmotionState
  ): StateDecision {
    return {
      nextState: currentState,
      empathyLevel: sessionState.currentEmpathyLevel,
      shouldProgress: false,
      constraints: STATE_CONSTRAINTS[currentState] || {},
      reason: '维持当前状态',
      transitionScore: 0,
    };
  }

  /**
   * 获取状态约束
   */
  getStateConstraints(state: GlobalState): StateConstraints {
    return STATE_CONSTRAINTS[state] || {};
  }

  /**
   * 检查是否可以推进
   */
  canProgress(currentState: GlobalState, emotion: EmotionState): boolean {
    if (emotion.intensity > this.config.emotionIntensityThreshold) return false;
    const constraints = STATE_CONSTRAINTS[currentState];
    if (constraints?.noProgression) return false;
    return true;
  }
}
