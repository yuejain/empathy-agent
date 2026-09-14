/**
 * 塔罗破冰模块 - 牌面匹配算法
 *
 * 基于情绪状态和已知主题智能选择3张候选牌
 * 策略：至少1张与情绪相关 + 至少1张与主题相关 + 至少1张随机
 */

import {
  TarotCard, CardId, CardCandidates,
  DrawRequest, CardEmotionProfile,
} from './types';
import {
  MAJOR_ARCANA, getCardById,
  EMOTION_CARD_MAP, THEME_CARD_MAP,
} from './card-data';

// ==================== 情绪-牌面匹配器 ====================

export class EmotionCardMatcher {
  /**
   * 基于当前情绪状态匹配最相关的牌
   */
  match(currentEmotion?: string, intensity?: number): CardId {
    if (!currentEmotion) {
      return this.getRandomCard();
    }

    // 1. 直接映射查找
    const directMatch = EMOTION_CARD_MAP[currentEmotion];
    if (directMatch && directMatch.length > 0) {
      // 根据强度选择
      if (intensity !== undefined && intensity > 0.7) {
        // 高强度：选择更强烈的牌
        return this.selectByIntensity(directMatch, intensity, 'high');
      } else if (intensity !== undefined && intensity < 0.4) {
        // 低强度：选择更温和的牌
        return this.selectByIntensity(directMatch, intensity, 'low');
      }
      // 中等强度：随机选择
      return directMatch[Math.floor(Math.random() * directMatch.length)];
    }

    // 2. 模糊匹配
    const fuzzyMatch = this.fuzzyMatchEmotion(currentEmotion);
    if (fuzzyMatch) {
      return fuzzyMatch;
    }

    // 3. 基于情感向量匹配
    return this.matchByEmotionVector(currentEmotion, intensity || 0.5);
  }

  /**
   * 根据强度选择牌面
   */
  private selectByIntensity(
    cards: CardId[],
    intensity: number,
    level: 'high' | 'low'
  ): CardId {
    // 获取每张牌的情感特征
    const scored = cards.map(id => {
      const card = getCardById(id);
      if (!card) return { id, score: 0 };

      const profile = card.emotionProfile;
      // 高强度选择高唤醒度的牌，低强度选择低唤醒度的牌
      const arousalMatch = level === 'high'
        ? profile.arousal
        : (1 - profile.arousal);

      return { id, score: arousalMatch };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0].id;
  }

  /**
   * 模糊匹配情绪
   */
  private fuzzyMatchEmotion(emotion: string): CardId | null {
    const emotionSynonyms: Record<string, string[]> = {
      '焦虑': ['紧张', '不安', '担心', '忧虑'],
      '困惑': ['迷茫', '不解', '疑惑', '不确定'],
      '恐惧': ['害怕', '惊恐', '畏惧', '恐慌'],
      '悲伤': ['难过', '伤心', '痛苦', '哀伤'],
      '愤怒': ['生气', '恼火', '暴怒', '愤慨'],
      '无力': ['无助', '无能为力', '束手无策'],
      '麻木': ['冷漠', '无感', '空白', '倦怠'],
      '羞耻': ['羞愧', '惭愧', '尴尬', '自卑'],
      '期待': ['盼望', '憧憬', '向往', '希望'],
      '希望': ['乐观', '信心', '期盼'],
      '好奇': ['感兴趣', '探索欲', '求知欲'],
      '喜悦': ['快乐', '高兴', '开心', '满足'],
      '孤独': ['寂寞', '孤立', '被遗忘'],
      '挫败': ['失败感', '沮丧', '受挫'],
      '矛盾': ['纠结', '挣扎', '两难'],
    };

    for (const [key, synonyms] of Object.entries(emotionSynonyms)) {
      if (key === emotion || synonyms.includes(emotion)) {
        const cards = EMOTION_CARD_MAP[key];
        if (cards && cards.length > 0) {
          return cards[Math.floor(Math.random() * cards.length)];
        }
      }
    }

    return null;
  }

  /**
   * 基于情感向量匹配
   */
  private matchByEmotionVector(emotion: string, intensity: number): CardId {
    // 简单的向量匹配：根据情绪的效价和唤醒度
    // 实际应用中应使用 bge-m3 计算语义相似度
    const emotionVectors: Record<string, { valence: number; arousal: number }> = {
      '焦虑': { valence: -0.5, arousal: 0.7 },
      '困惑': { valence: -0.3, arousal: 0.5 },
      '恐惧': { valence: -0.8, arousal: 0.9 },
      '悲伤': { valence: -0.7, arousal: 0.3 },
      '愤怒': { valence: -0.8, arousal: 0.9 },
      '无力': { valence: -0.6, arousal: 0.3 },
      '麻木': { valence: -0.2, arousal: 0.1 },
      '羞耻': { valence: -0.7, arousal: 0.6 },
      '期待': { valence: 0.5, arousal: 0.6 },
      '希望': { valence: 0.6, arousal: 0.5 },
      '好奇': { valence: 0.4, arousal: 0.7 },
      '喜悦': { valence: 0.8, arousal: 0.8 },
      '孤独': { valence: -0.5, arousal: 0.3 },
      '挫败': { valence: -0.6, arousal: 0.5 },
      '矛盾': { valence: -0.2, arousal: 0.6 },
    };

    const targetVector = emotionVectors[emotion] || { valence: -0.3, arousal: 0.5 };

    let bestMatch: CardId = 'moon';
    let bestDistance = Infinity;

    for (const card of MAJOR_ARCANA) {
      const profile = card.emotionProfile;
      const distance = Math.sqrt(
        Math.pow(targetVector.valence - profile.valence, 2) +
        Math.pow(targetVector.arousal - profile.arousal, 2)
      );

      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatch = card.id;
      }
    }

    return bestMatch;
  }

  /**
   * 获取随机牌
   */
  private getRandomCard(): CardId {
    const index = Math.floor(Math.random() * MAJOR_ARCANA.length);
    return MAJOR_ARCANA[index].id;
  }
}

// ==================== 主题-牌面匹配器 ====================

export class ThemeCardMatcher {
  /**
   * 基于已知主题和价值冲突匹配最相关的牌
   */
  match(themes: string[] = [], conflicts: string[] = []): CardId {
    // 收集所有主题标签
    const allTags = [...themes, ...conflicts];

    if (allTags.length === 0) {
      return 'moon'; // 默认月亮——最通用的迷茫象征
    }

    // 计算每张牌与用户主题的重叠度
    let bestMatch: CardId = 'moon';
    let bestOverlap = 0;

    for (const card of MAJOR_ARCANA) {
      const cardThemes = card.themeProfile.themes;
      const cardKeywords = card.themeProfile.keywords;

      // 计算重叠
      let overlap = 0;
      for (const tag of allTags) {
        if (cardThemes.includes(tag) || cardKeywords.includes(tag)) {
          overlap++;
        }
      }

      // 模糊匹配
      for (const tag of allTags) {
        for (const keyword of cardKeywords) {
          if (tag.includes(keyword) || keyword.includes(tag)) {
            overlap += 0.5;
          }
        }
      }

      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestMatch = card.id;
      }
    }

    return bestMatch;
  }

  /**
   * 基于主题标签映射匹配
   */
  matchByThemeMap(themes: string[]): CardId[] {
    const matchedCards: CardId[] = [];

    for (const theme of themes) {
      const cards = THEME_CARD_MAP[theme];
      if (cards) {
        matchedCards.push(...cards);
      }
    }

    // 去重
    return [...new Set(matchedCards)];
  }
}

// ==================== 牌面选择器 ====================

export class CardSelector {
  private emotionMatcher: EmotionCardMatcher;
  private themeMatcher: ThemeCardMatcher;

  constructor() {
    this.emotionMatcher = new EmotionCardMatcher();
    this.themeMatcher = new ThemeCardMatcher();
  }

  /**
   * 从22张大阿尔卡纳中选出3张供用户选择
   *
   * 策略：
   * - Slot 1: 与当前情绪状态相关
   * - Slot 2: 与已知主题或价值冲突相关
   * - Slot 3: 随机（从剩余牌中抽）
   */
  selectThreeCards(request: DrawRequest): CardCandidates {
    // Slot 1: 情绪相关牌
    const emotionCard = this.emotionMatcher.match(
      request.currentEmotion,
      request.emotionIntensity
    );

    // Slot 2: 主题相关牌
    const themeCard = this.themeMatcher.match(
      request.knownThemes,
      request.knownConflicts
    );

    // 确保前两张不重复
    let themeCardFinal = themeCard;
    if (themeCardFinal === emotionCard) {
      // 如果重复，从主题映射中找第二选择
      const themeCards = this.themeMatcher.matchByThemeMap(request.knownThemes || []);
      const alternative = themeCards.find(id => id !== emotionCard);
      themeCardFinal = alternative || this.getRandomExcluding([emotionCard]);
    }

    // Slot 3: 随机牌（排除已选的）
    const randomCard = this.getRandomExcluding([emotionCard, themeCardFinal]);

    // 组装3张牌
    const selected: [TarotCard, TarotCard, TarotCard] = [
      getCardById(emotionCard)!,
      getCardById(themeCardFinal)!,
      getCardById(randomCard)!,
    ];

    // 打乱顺序（用户不知道哪张是精心选的，哪张是随机的）
    this.shuffleArray(selected);

    return {
      cards: selected,
      selectionReason: {
        emotionCard,
        themeCard: themeCardFinal,
        randomCard,
      },
    };
  }

  /**
   * 获取随机牌（排除指定牌）
   */
  private getRandomExcluding(exclude: CardId[]): CardId {
    const available = MAJOR_ARCANA.filter(card => !exclude.includes(card.id));
    const index = Math.floor(Math.random() * available.length);
    return available[index].id;
  }

  /**
   * 打乱数组顺序（Fisher-Yates 算法）
   */
  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }
}

// ==================== 牌面匹配管理器 ====================

export class CardMatcher {
  private selector: CardSelector;

  constructor() {
    this.selector = new CardSelector();
  }

  /**
   * 选择3张候选牌
   */
  selectCards(request: DrawRequest): CardCandidates {
    return this.selector.selectThreeCards(request);
  }

  /**
   * 获取牌面的情感特征
   */
  getCardEmotionProfile(cardId: CardId): CardEmotionProfile | undefined {
    const card = getCardById(cardId);
    return card?.emotionProfile;
  }

  /**
   * 获取牌面的主题标签
   */
  getCardThemeProfile(cardId: CardId): string[] {
    const card = getCardById(cardId);
    return card?.themeProfile.themes || [];
  }
}
