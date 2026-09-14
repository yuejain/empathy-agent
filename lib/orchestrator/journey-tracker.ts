/**
 * 旅程阶段追踪器
 *
 * 多会话旅程阶段：
 * Stage 1: 觉察与稳定（Sessions 1-3）
 * Stage 2: 具体化与梳理（Sessions 3-6）
 * Stage 3: 行动与验证（Sessions 6-10）
 * Stage 4: 整合与方向（Sessions 10+）
 *
 * 不是线性的，可以回退
 * 不是按会话数硬切，而是按用户进展判断
 */

import {
  JourneyStage, JourneyStageGuidance,
  GlobalState, SessionState,
} from './types';

// ==================== 旅程阶段指导 ====================

const STAGE_GUIDANCE: Record<JourneyStage, JourneyStageGuidance> = {
  journey_stage_1: {
    primaryGoal: '建立信任，帮用户开始表达',
    recommendedStates: ['EMPATHY_PHASE', 'TAROT_ENTRY', 'IMAGE_ENTRY'],
    avoidStates: ['EXPLORE_PHASE', 'ACTION_PHASE'],
    sessionOpeningStrategy: 'gentle_check_in',
    maxExploreDepth: 1,
    pacing: 'slow',
  },
  journey_stage_2: {
    primaryGoal: '帮用户看清具体的冲突和模式',
    recommendedStates: ['EMPATHY_PHASE', 'EXPLORE_PHASE'],
    avoidStates: [],
    sessionOpeningStrategy: 'resume_last_exploration',
    maxExploreDepth: 3,
    pacing: 'medium',
  },
  journey_stage_3: {
    primaryGoal: '通过行动验证假设',
    recommendedStates: ['ACTION_PHASE', 'EXPLORE_PHASE'],
    avoidStates: ['TAROT_ENTRY'],
    sessionOpeningStrategy: 'check_experiment_results',
    maxExploreDepth: 3,
    pacing: 'medium',
  },
  journey_stage_4: {
    primaryGoal: '整合洞察，形成可执行方向',
    recommendedStates: ['REVIEW_PHASE', 'EXPLORE_PHASE'],
    avoidStates: [],
    sessionOpeningStrategy: 'review_and_new_direction',
    maxExploreDepth: 2,
    pacing: 'gentle',
  },
};

// ==================== 旅程阶段追踪器 ====================

export class JourneyStageTracker {
  /**
   * 评估用户当前所处的旅程阶段
   */
  evaluate(userModel: Record<string, unknown>, sessionCount: number): JourneyStage {
    const indicators = this.extractIndicators(userModel, sessionCount);

    if (indicators.hasDirection) return 'journey_stage_4';
    if (indicators.hasCompletedExperiment) return 'journey_stage_3';
    if (indicators.hasIdentifiedConflict) return 'journey_stage_2';
    return 'journey_stage_1';
  }

  /**
   * 提取旅程指标
   */
  private extractIndicators(
    userModel: Record<string, unknown>,
    sessionCount: number
  ): {
    canArticulateFeelings: boolean;
    hasIdentifiedConflict: boolean;
    hasCompletedExperiment: boolean;
    hasDirection: boolean;
    sessionCount: number;
    themeStability: number;
  } {
    const coreMemory = (userModel.core_memory || {}) as Record<string, unknown>;
    const values = (coreMemory.values || []) as unknown[];
    const constraints = (coreMemory.constraints || []) as unknown[];
    const themes = (coreMemory.themes || []) as unknown[];
    const experiments = (userModel.action_experiments || []) as unknown[];
    const directionCards = (userModel.direction_cards || []) as unknown[];

    return {
      canArticulateFeelings: themes.length > 0 || sessionCount >= 2,
      hasIdentifiedConflict: values.length >= 2 && constraints.length >= 1,
      hasCompletedExperiment: experiments.some((e: any) => e.status === 'completed'),
      hasDirection: directionCards.some((dc: any) => dc.status === 'validated'),
      sessionCount,
      themeStability: themes.length > 0 ? 0.5 : 0,
    };
  }

  /**
   * 获取当前旅程阶段的编排指导
   */
  getGuidance(stage: JourneyStage): JourneyStageGuidance {
    return STAGE_GUIDANCE[stage];
  }

  /**
   * 生成会话开场策略
   */
  generateOpeningStrategy(
    stage: JourneyStage,
    userModel: Record<string, unknown>,
    lastSession?: Record<string, unknown>
  ): string {
    const guidance = STAGE_GUIDANCE[stage];

    switch (guidance.sessionOpeningStrategy) {
      case 'gentle_check_in':
        return '最近怎么样？有什么想聊的吗？';

      case 'resume_last_exploration': {
        const lastHypothesis = lastSession?.last_hypothesis as string | undefined;
        if (lastHypothesis) {
          return `上次我们在探索"${lastHypothesis}"这个方向，今天想继续吗？还是有新的想法？`;
        }
        return '上次我们聊了一些关于你状态的事情，今天想从哪里开始？';
      }

      case 'check_experiment_results': {
        const experiments = (userModel.action_experiments || []) as any[];
        const active = experiments.find((e: any) =>
          e.status === 'in_progress' || e.status === 'planned'
        );
        if (active) {
          return `上次你有一个行动实验："${active.name}"。这段时间有进展吗？`;
        }
        return '上次我们聊到一些行动想法，今天想怎么继续？';
      }

      case 'review_and_new_direction':
        return '我们已经聊了一段时间了，要不要先回顾一下，看看有什么变化？';

      default:
        return '今天想聊些什么？';
    }
  }

  /**
   * 检查是否应该触发复盘
   */
  shouldTriggerReview(
    stage: JourneyStage,
    sessionCount: number,
    lastReviewSession?: number
  ): boolean {
    // 每3次会话触发一次复盘
    if (sessionCount >= 3 && (!lastReviewSession || sessionCount - lastReviewSession >= 3)) {
      return true;
    }

    // Stage 3 和 Stage 4 更频繁复盘
    if ((stage === 'journey_stage_3' || stage === 'journey_stage_4') &&
        sessionCount >= 2 && (!lastReviewSession || sessionCount - lastReviewSession >= 2)) {
      return true;
    }

    return false;
  }
}
