/**
 * 塔罗破冰模块 - 替代入口系统
 *
 * 不是所有用户都接受塔罗，需要设计替代入口：
 * - 图片投射：用不含塔罗术语的抽象图片替代
 * - 场景选择：描述3个生活场景，选最触动的
 * - 关键词选择：提供6个关键词，选1-3个
 * - 直接对话：跳过破冰工具，直接开放式提问
 */

import { EntryType, AlternativeEntry, AlternativeItem } from './types';

// ==================== 替代入口定义 ====================

/** 图片投射入口 */
export const IMAGE_ENTRIES: AlternativeEntry = {
  type: 'image',
  title: '看一张图片',
  description: '用抽象图片触发联想和感受',
  items: [
    {
      id: 'img_01',
      text: '一条分叉的路，两边都看不到尽头',
      emotionHint: '选择困难、迷茫',
      themeHint: 'choice',
    },
    {
      id: 'img_02',
      text: '一个人站在窗前，窗外是雨',
      emotionHint: '孤独、沉思',
      themeHint: 'introspection',
    },
    {
      id: 'img_03',
      text: '一扇半开的门，门缝里透出光',
      emotionHint: '希望、犹豫',
      themeHint: 'hope',
    },
    {
      id: 'img_04',
      text: '一片平静的湖面，倒映着天空',
      emotionHint: '平静、渴望安宁',
      themeHint: 'peace',
    },
    {
      id: 'img_05',
      text: '一座正在建造的桥，还没连到对岸',
      emotionHint: '进行中、未完成',
      themeHint: 'progress',
    },
    {
      id: 'img_06',
      text: '一个人背着包，站在山顶看日出',
      emotionHint: '成就、新的开始',
      themeHint: 'achievement',
    },
  ],
};

/** 场景选择入口 */
export const SCENARIO_ENTRIES: AlternativeEntry = {
  type: 'scenario',
  title: '选择一个场景',
  description: '用生活场景触发共鸣',
  items: [
    {
      id: 'scene_01',
      text: '早上醒来，不想起床，但又不知道该做什么',
      emotionHint: '无力、迷茫',
      themeHint: 'motivation',
    },
    {
      id: 'scene_02',
      text: '坐在办公桌前，看着屏幕发呆，心不在焉',
      emotionHint: '麻木、倦怠',
      themeHint: 'burnout',
    },
    {
      id: 'scene_03',
      text: '和朋友聚会，大家聊得很开心，但你觉得自己格格不入',
      emotionHint: '孤独、疏离',
      themeHint: 'belonging',
    },
    {
      id: 'scene_04',
      text: '深夜刷手机，停不下来，但其实什么都不想看',
      emotionHint: '空虚、逃避',
      themeHint: 'avoidance',
    },
    {
      id: 'scene_05',
      text: '有人问你"最近怎么样"，你笑着说"挺好的"',
      emotionHint: '压抑、伪装',
      themeHint: 'authenticity',
    },
    {
      id: 'scene_06',
      text: '做了一个决定，但反复想"是不是选错了"',
      emotionHint: '焦虑、后悔',
      themeHint: 'decision_anxiety',
    },
  ],
};

/** 关键词选择入口 */
export const KEYWORD_ENTRIES: AlternativeEntry = {
  type: 'keyword',
  title: '选几个词',
  description: '用关键词快速切入',
  items: [
    {
      id: 'kw_01',
      text: '迷茫',
      emotionHint: 'confusion',
      themeHint: 'direction',
    },
    {
      id: 'kw_02',
      text: '焦虑',
      emotionHint: 'anxiety',
      themeHint: 'uncertainty',
    },
    {
      id: 'kw_03',
      text: '孤独',
      emotionHint: 'loneliness',
      themeHint: 'connection',
    },
    {
      id: 'kw_04',
      text: '疲惫',
      emotionHint: 'exhaustion',
      themeHint: 'energy',
    },
    {
      id: 'kw_05',
      text: '纠结',
      emotionHint: 'ambivalence',
      themeHint: 'choice',
    },
    {
      id: 'kw_06',
      text: '不甘心',
      emotionHint: 'frustration',
      themeHint: 'unfulfilled',
    },
    {
      id: 'kw_07',
      text: '想改变',
      emotionHint: 'anticipation',
      themeHint: 'change',
    },
    {
      id: 'kw_08',
      text: '被困住',
      emotionHint: 'helplessness',
      themeHint: 'constraint',
    },
    {
      id: 'kw_09',
      text: '不知道想要什么',
      emotionHint: 'confusion',
      themeHint: 'identity',
    },
    {
      id: 'kw_10',
      text: '压力大',
      emotionHint: 'stress',
      themeHint: 'pressure',
    },
  ],
};

/** 直接对话入口 */
export const DIRECT_ENTRY: AlternativeEntry = {
  type: 'direct',
  title: '直接聊聊',
  description: '跳过破冰工具，直接开放式提问',
  items: [
    {
      id: 'direct_01',
      text: '最近有什么事情一直占据你的脑子？',
    },
    {
      id: 'direct_02',
      text: '如果用一个词形容你现在的状态，会是什么？',
    },
    {
      id: 'direct_03',
      text: '你今天为什么会来这里？',
    },
  ],
};

// ==================== 入口选择器 ====================

export class EntrySelector {
  /**
   * 获取指定类型的替代入口
   */
  getEntry(type: EntryType): AlternativeEntry | null {
    switch (type) {
      case 'image': return IMAGE_ENTRIES;
      case 'scenario': return SCENARIO_ENTRIES;
      case 'keyword': return KEYWORD_ENTRIES;
      case 'direct': return DIRECT_ENTRY;
      case 'tarot': return null; // 塔罗入口由 TarotInteractionManager 处理
      default: return null;
    }
  }

  /**
   * 获取所有可用的替代入口
   */
  getAllAlternatives(): AlternativeEntry[] {
    return [IMAGE_ENTRIES, SCENARIO_ENTRIES, KEYWORD_ENTRIES, DIRECT_ENTRY];
  }

  /**
   * 根据用户情绪推荐替代入口
   */
  recommendByEmotion(emotion: string): EntryType {
    // 偏理性的用户可能更适合场景选择
    const rationalEmotions = ['困惑', '焦虑', '纠结'];
    if (rationalEmotions.includes(emotion)) {
      return 'scenario';
    }

    // 偏感性的用户可能更适合图片投射
    const emotionalEmotions = ['悲伤', '孤独', '麻木'];
    if (emotionalEmotions.includes(emotion)) {
      return 'image';
    }

    // 想快速切入的用户适合关键词
    const activeEmotions = ['愤怒', '不甘心', '想改变'];
    if (activeEmotions.includes(emotion)) {
      return 'keyword';
    }

    // 默认
    return 'keyword';
  }

  /**
   * 生成替代入口的引导话术
   */
  generateAlternativeGreeting(type: EntryType): string {
    switch (type) {
      case 'image':
        return `不想用牌的话，也可以看一张图片。
下面几张图片里，哪一张让你有感觉？
选择之后，我们可以聊聊你看到它时想到了什么。`;

      case 'scenario':
        return `那我们换个方式。
下面几个场景里，哪个最像你现在的状态？
选一个，然后我们聊聊。`;

      case 'keyword':
        return `那我们直接一点。
下面这些词里，哪些让你有感觉？
选1-3个就好，然后我们从这里开始。`;

      case 'direct':
        return `好，我们直接聊。
最近有什么事情一直占据你的脑子？
想到什么说什么，不用想清楚。`;

      default:
        return '我们直接聊吧。最近有什么想说的？';
    }
  }
}
