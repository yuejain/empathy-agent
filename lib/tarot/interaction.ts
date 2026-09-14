/**
 * 塔罗破冰模块 - 交互流程管理
 *
 * 管理抽牌、翻牌、用户选择、分支处理的完整流程
 */

import {
  TarotCard, CardId, AspectType, UserReaction,
  DrawRequest, CardCandidates, FlipResult,
  TarotInteraction, TarotProfile, TransitionTarget,
  SafetyCheckResult, TarotModuleConfig, DEFAULT_TAROT_CONFIG,
  EntryRecommendation, EntryType,
} from './types';
import { getCardById, MAJOR_ARCANA } from './card-data';
import { CardMatcher } from './card-matcher';

// ==================== 安全检查器 ====================

export class TarotSafetyChecker {
  private sensitiveCards: Set<CardId> = new Set(['death', 'tower', 'devil']);

  /**
   * 翻牌后的安全检查
   */
  check(
    card: TarotCard,
    userReaction: UserReaction,
    userInput?: string
  ): SafetyCheckResult {
    // 1. 敏感牌面 + 强烈负面反应
    if (card.isSensitive && this.isNegativeReaction(userReaction)) {
      return {
        isSafe: true, // 安全但需要特殊处理
        action: 'empathy_first',
        instruction: '先处理用户的情绪反应，不推进探索',
        empathyLevel: 'L1-L2',
      };
    }

    // 2. 用户在翻牌后表达自伤想法
    if (userInput && this.containsSelfHarmSignal(userInput)) {
      return {
        isSafe: false,
        action: 'safety_protocol',
        instruction: '停止塔罗流程，进入危机干预',
        riskLevel: 'high',
      };
    }

    // 3. 用户过度解读（"这是不是说我命不好"）
    if (userInput && this.containsFateInterpretation(userInput)) {
      return {
        isSafe: true,
        action: 'gentle_redirect',
        instruction: '温和说明这不是预测，引导回到自身感受',
      };
    }

    // 4. 正常情况
    return {
      isSafe: true,
      action: 'continue',
      instruction: '继续正常流程',
    };
  }

  /**
   * 检查是否为负面反应
   */
  private isNegativeReaction(reaction: UserReaction): boolean {
    return ['not_at_all'].includes(reaction);
  }

  /**
   * 检查是否包含自伤信号
   */
  private containsSelfHarmSignal(input: string): boolean {
    const signals = [
      '想死', '不想活', '自杀', '自残', '割腕', '跳楼',
      '结束生命', '活着没意思', '死了算了',
    ];
    return signals.some(signal => input.includes(signal));
  }

  /**
   * 检查是否包含命运解读
   */
  private containsFateInterpretation(input: string): boolean {
    const patterns = [
      '这是不是说', '是不是意味着', '预示', '命运',
      '命中注定', '我的命', '天注定', '注定',
    ];
    return patterns.some(pattern => input.includes(pattern));
  }
}

// ==================== 引导话术生成器 ====================

export class GreetingGenerator {
  /**
   * 生成抽牌引导话术
   */
  generateGreeting(trigger: DrawRequest['trigger']): string {
    switch (trigger) {
      case 'first_hesitation':
        return `很多人在刚开始探索的时候，会觉得不知道从哪里说起。
我有一个小工具——不是算命，也不是预测——就是一张图片和几个问题，可能帮你打开一个角度。

要试试吗？不喜欢的话随时可以跳过。`;

      case 'user_request':
        return `好，我们一起抽一张。
这不是预测未来，只是一个让自己慢下来的方式。
牌面上的图像可能会让你想到一些东西，也可能什么都没想到，两种都好。`;

      case 'exploration_stuck':
        return `我们聊了一段时间了，如果你觉得有点绕不出来，
要不要换一个方式——看一张图片，看看它会不会触发你想到什么？
不想试也完全没关系。`;

      default:
        return `我这里有一些图片和问题，可能帮你打开一个角度。
这不是算命，也不是预测——只是一个让自己慢下来的方式。
要试试吗？`;
    }
  }

  /**
   * 生成翻牌后的话术
   */
  generateFlipGreeting(card: TarotCard): string {
    const name = card.isSensitive ? card.displayName : card.name;
    return `这张牌叫"${name}"。
${card.description}

看到这张牌，下面三个描述里，哪个最触动你？
也可以都不像，都没关系。`;
  }

  /**
   * 生成用户选择A后的回应
   */
  generateAspectAResponse(card: TarotCard, userExpression?: string): string {
    const name = card.isSensitive ? card.displayName : card.name;
    return `${name}牌常让人想到那种${card.aspects.A.substring(0, 10)}的感觉。
你说"像"——是最近有这种感觉吗？愿意多说一点吗？`;
  }

  /**
   * 生成用户选择B后的回应
   */
  generateAspectBResponse(card: TarotCard, userExpression?: string): string {
    return `你选了"${card.aspects.B}"这一条。
这种感觉，是来自具体的事情——比如工作、关系——还是更像一种弥漫的、说不清楚的不安？`;
  }

  /**
   * 生成用户选择C后的回应
   */
  generateAspectCResponse(card: TarotCard): string {
    return `你选了这个问题。那我问你——
${card.aspects.C}
不需要想清楚，想到什么说什么。`;
  }

  /**
   * 生成用户说"都不像"后的回应
   */
  generateNoMatchResponse(): string {
    return `没关系，不是每张牌都能说到心里去。
有时候"都不像"本身也是一种信号——也许你现在的状态不太好用一个画面来概括。

不管牌面的事了，我们直接聊。
最近有什么事情一直占据你的脑子？`;
  }
}

// ==================== 交互管理器 ====================

export class TarotInteractionManager {
  private config: TarotModuleConfig;
  private matcher: CardMatcher;
  private safetyChecker: TarotSafetyChecker;
  private greetingGenerator: GreetingGenerator;

  // 用户塔罗档案（MVP 阶段使用内存存储）
  private profiles: Map<string, TarotProfile> = new Map();

  // 每会话抽牌次数
  private sessionDrawCounts: Map<string, number> = new Map();

  constructor(config: Partial<TarotModuleConfig> = {}) {
    this.config = { ...DEFAULT_TAROT_CONFIG, ...config };
    this.matcher = new CardMatcher();
    this.safetyChecker = new TarotSafetyChecker();
    this.greetingGenerator = new GreetingGenerator();
  }

  // ==================== 抽牌流程 ====================

  /**
   * 检查是否应该触发塔罗入口
   */
  shouldTrigger(userId: string, sessionId: string, trigger: DrawRequest['trigger']): boolean {
    // 检查每会话抽牌次数限制
    const drawCount = this.sessionDrawCounts.get(sessionId) || 0;
    if (drawCount >= this.config.maxDrawsPerSession) {
      return false;
    }

    // 检查用户是否明确拒绝过
    const profile = this.getOrCreateProfile(userId);
    if (profile.preferredEntry === 'direct') {
      return false;
    }

    return true;
  }

  /**
   * 获取入口推荐
   */
  getEntryRecommendation(userId: string, sessionId: string): EntryRecommendation {
    const profile = this.getOrCreateProfile(userId);

    // 如果用户上次用了塔罗且有反应
    if (profile.preferredEntry === 'tarot' && profile.totalDraws > 0) {
      const lastInteraction = profile.interactions[profile.interactions.length - 1];
      if (lastInteraction && lastInteraction.userReaction !== 'not_at_all') {
        return {
          recommended: 'tarot',
          alternatives: ['image', 'scenario', 'keyword'],
          reason: '用户上次对塔罗有积极反应',
          greeting: this.greetingGenerator.generateGreeting('user_request'),
        };
      }
    }

    // 如果用户上次拒绝了塔罗
    if (profile.preferredEntry === 'direct') {
      return {
        recommended: 'direct',
        alternatives: ['keyword', 'scenario'],
        reason: '用户偏好直接对话',
        greeting: '最近有什么事情一直占据你的脑子？',
      };
    }

    // 默认推荐塔罗
    return {
      recommended: 'tarot',
      alternatives: ['image', 'scenario', 'keyword', 'direct'],
      reason: '首次对话或无明确偏好',
      greeting: this.greetingGenerator.generateGreeting('first_hesitation'),
    };
  }

  /**
   * 执行抽牌
   */
  drawCards(request: DrawRequest): {
    candidates: CardCandidates;
    greeting: string;
  } | null {
    // 检查是否可以抽牌
    if (!this.shouldTrigger(request.userId, request.sessionId, request.trigger)) {
      return null;
    }

    // 选择3张候选牌
    const candidates = this.matcher.selectCards(request);

    // 生成引导话术
    const greeting = this.greetingGenerator.generateGreeting(request.trigger);

    // 更新抽牌次数
    const drawCount = this.sessionDrawCounts.get(request.sessionId) || 0;
    this.sessionDrawCounts.set(request.sessionId, drawCount + 1);

    return { candidates, greeting };
  }

  // ==================== 翻牌流程 ====================

  /**
   * 处理用户翻牌
   */
  handleFlip(
    userId: string,
    sessionId: string,
    card: TarotCard,
    selectedAspect: AspectType,
    userReaction: UserReaction,
    userExpression?: string
  ): {
    flipResult: FlipResult;
    response: string;
    transition: TransitionTarget;
  } {
    // 1. 安全检查
    const safetyCheck = this.safetyChecker.check(card, userReaction, userExpression);

    // 2. 获取面向文本
    const aspectText = selectedAspect === 'none'
      ? '都不像'
      : card.aspects[selectedAspect];

    // 3. 构建翻牌结果
    const flipResult: FlipResult = {
      card,
      selectedAspect,
      aspectText,
      userReaction,
      followUpExpression: userExpression,
      safetyCheck,
    };

    // 4. 生成回应
    let response: string;
    let transition: TransitionTarget;

    if (safetyCheck.action === 'safety_protocol') {
      response = '我注意到你可能正在经历困难。你的安全是最重要的。';
      transition = 'safety_protocol';
    } else if (safetyCheck.action === 'empathy_first') {
      response = `我看到这张牌让你有些不舒服。
这种感觉是可以理解的。你愿意说说是什么让你有这种感觉吗？`;
      transition = 'emotion_exploration';
    } else if (safetyCheck.action === 'gentle_redirect') {
      response = `我理解你想从牌面中找到答案。
不过这张牌不是预测未来——它只是一个入口，帮你看清自己现在的状态。
你看到这张牌，你自己有什么感觉？`;
      transition = 'emotion_exploration';
    } else if (selectedAspect === 'A') {
      response = this.greetingGenerator.generateAspectAResponse(card, userExpression);
      transition = 'emotion_exploration';
    } else if (selectedAspect === 'B') {
      response = this.greetingGenerator.generateAspectBResponse(card, userExpression);
      transition = 'value_exploration';
    } else if (selectedAspect === 'C') {
      response = this.greetingGenerator.generateAspectCResponse(card);
      transition = 'constraint_exploration';
    } else {
      response = this.greetingGenerator.generateNoMatchResponse();
      transition = 'direct_dialogue';
    }

    // 5. 记录交互
    this.recordInteraction(userId, sessionId, {
      card: card.id,
      selectedAspect,
      aspectText,
      userReaction,
      followUpExpression: userExpression,
      transition,
    });

    // 6. 更新用户偏好
    this.updateUserPreference(userId, selectedAspect, userReaction);

    return { flipResult, response, transition };
  }

  // ==================== 记忆集成 ====================

  /**
   * 记录塔罗交互
   */
  private recordInteraction(
    userId: string,
    sessionId: string,
    data: {
      card: CardId;
      selectedAspect: AspectType;
      aspectText: string;
      userReaction: UserReaction;
      followUpExpression?: string;
      transition: TransitionTarget;
    }
  ): void {
    const profile = this.getOrCreateProfile(userId);

    // 提取隐喻标签
    const metaphorTags = this.extractMetaphorTags(data.card, data.selectedAspect, data.followUpExpression);

    const interaction: TarotInteraction = {
      drawId: `td_${Date.now().toString(36)}`,
      sessionId,
      card: data.card,
      cardChinese: getCardById(data.card)?.name || '',
      selectedAspect: data.selectedAspect,
      aspectText: data.aspectText,
      userReaction: data.userReaction,
      followUpExpression: data.followUpExpression,
      metaphorTags,
      transitionTo: data.transition,
      timestamp: new Date().toISOString(),
    };

    profile.interactions.push(interaction);
    profile.totalDraws++;

    // 更新模式分析
    this.updatePatterns(profile);
  }

  /**
   * 提取隐喻标签
   */
  private extractMetaphorTags(
    card: CardId,
    aspect: AspectType,
    expression?: string
  ): string[] {
    const tags: string[] = [];

    // 从牌面关键词提取
    const cardData = getCardById(card);
    if (cardData) {
      tags.push(...cardData.themeProfile.keywords.slice(0, 3));
    }

    // 从用户表达中提取
    if (expression) {
      const keywords = ['看不清', '不确定', '焦虑', '独处', '安静',
        '束缚', '自由', '选择', '迷茫', '希望', '恐惧'];
      for (const kw of keywords) {
        if (expression.includes(kw)) {
          tags.push(kw);
        }
      }
    }

    return [...new Set(tags)];
  }

  /**
   * 更新用户模式分析
   */
  private updatePatterns(profile: TarotProfile): void {
    if (profile.interactions.length < 2) return;

    const recentInteractions = profile.interactions.slice(-5);

    // 分析共鸣模式
    const resonantCards = recentInteractions
      .filter(i => i.userReaction === 'very_much' || i.userReaction === 'somewhat')
      .map(i => i.card);

    const nonResonantCards = recentInteractions
      .filter(i => i.userReaction === 'not_at_all')
      .map(i => i.card);

    // 收集隐喻标签
    const allMetaphors = recentInteractions.flatMap(i => i.metaphorTags);
    const metaphorFreq = new Map<string, number>();
    allMetaphors.forEach(tag => {
      metaphorFreq.set(tag, (metaphorFreq.get(tag) || 0) + 1);
    });

    const preferredMetaphors = Array.from(metaphorFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag]) => tag);

    profile.patterns = {
      resonancePattern: `用户对象征内在状态的牌有反应，对象征行动力的牌反应较弱`,
      implication: '用户目前更需要被理解和有空间，而非被推动',
      preferredMetaphors,
      avoidedMetaphors: [],
      favoriteCards: resonantCards as CardId[],
      avoidedCards: nonResonantCards as CardId[],
    };
  }

  /**
   * 更新用户偏好
   */
  private updateUserPreference(
    userId: string,
    aspect: AspectType,
    reaction: UserReaction
  ): void {
    const profile = this.getOrCreateProfile(userId);

    if (reaction === 'very_much' || reaction === 'somewhat') {
      profile.preferredEntry = 'tarot';
    } else if (reaction === 'not_at_all' && aspect === 'none') {
      profile.preferredEntry = 'direct';
    }
  }

  // ==================== 档案管理 ====================

  /**
   * 获取或创建用户塔罗档案
   */
  getOrCreateProfile(userId: string): TarotProfile {
    if (!this.profiles.has(userId)) {
      this.profiles.set(userId, {
        userId,
        totalDraws: 0,
        preferredEntry: 'tarot',
        interactions: [],
        patterns: {
          resonancePattern: '',
          implication: '',
          preferredMetaphors: [],
          avoidedMetaphors: [],
          favoriteCards: [],
          avoidedCards: [],
        },
      });
    }
    return this.profiles.get(userId)!;
  }

  /**
   * 获取用户塔罗档案
   */
  getProfile(userId: string): TarotProfile | undefined {
    return this.profiles.get(userId);
  }

  /**
   * 获取用户的塔罗交互历史
   */
  getInteractionHistory(userId: string): TarotInteraction[] {
    return this.getOrCreateProfile(userId).interactions;
  }
}
