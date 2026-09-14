/**
 * 会话摘要生成器
 * 在会话结束时生成结构化摘要，包括主题、情绪弧线、关键转折点等
 */

import { ConversationSummary, MemoryEntryType } from './types';
import { MemoryStore } from './memory-store';
import { MockEmbeddingModel, type EmbeddingModel } from './retrieval-engine';

/** 对话轮次 */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  emotion?: {
    primary: string;
    intensity: number;
    valence: number;
  };
}

/** 会话摘要生成结果 */
export interface SessionSummaryResult {
  summary: ConversationSummary;
  newEntities: Array<{
    type: MemoryEntryType;
    content: string;
    confidence: number;
  }>;
  sessionStats: {
    total_turns: number;
    user_turns: number;
    duration_seconds: number;
    dominant_emotion: string;
    emotion_trajectory: string;
  };
}

/**
 * 会话摘要生成器
 */
export class SessionSummaryGenerator {
  private store: MemoryStore;
  private embeddingModel: EmbeddingModel;

  constructor(store: MemoryStore) {
    this.store = store;
    this.embeddingModel = new MockEmbeddingModel();
  }

  /**
   * 生成会话摘要
   */
  async generateSummary(
    userId: string,
    sessionId: string,
    turns: ConversationTurn[]
  ): Promise<SessionSummaryResult> {
    // 1. 提取主题
    const topics = this.extractTopics(turns);

    // 2. 分析情绪弧线
    const emotionArc = this.analyzeEmotionArc(turns);

    // 3. 识别关键转折点
    const turningPoints = this.identifyTurningPoints(turns);

    // 4. 提取新信息
    const newInformation = this.extractNewInformation(turns);

    // 5. 提取行动项
    const actionItems = this.extractActionItems(turns);

    // 6. 生成摘要文本
    const summaryText = this.buildSummaryText(topics, emotionArc, turningPoints, newInformation);

    // 7. 生成摘要向量
    const embedding = await this.embeddingModel.encodeDense(summaryText);

    // 8. 识别新实体
    const newEntities = this.identifyNewEntities(turns, newInformation);

    // 9. 计算会话统计
    const sessionStats = this.calculateSessionStats(turns);

    // 10. 创建摘要对象
    const summary: ConversationSummary = {
      id: `summary_${Date.now().toString(36)}`,
      user_id: userId,
      session_id: sessionId,
      summary_text: summaryText,
      topics,
      emotions_arc: emotionArc,
      key_turning_points: turningPoints,
      new_information: newInformation,
      action_items: actionItems,
      embedding,
      created_at: new Date().toISOString(),
    };

    // 11. 存入用户画像
    const profile = this.store.getOrCreateUserProfile(userId);
    profile.conversation_summaries.push(summary);
    this.store.updateUserProfile(userId, { conversation_summaries: profile.conversation_summaries });

    return {
      summary,
      newEntities,
      sessionStats,
    };
  }

  /**
   * 提取对话主题
   */
  private extractTopics(turns: ConversationTurn[]): string[] {
    const userTurns = turns.filter(t => t.role === 'user');
    const topics: string[] = [];

    // 提取高频关键词作为主题
    const wordFreq = new Map<string, number>();
    const stopWords = new Set(['的', '了', '是', '在', '我', '你', '他', '她', '它',
      '们', '这', '那', '有', '和', '与', '或', '但', '而', '也', '都',
      '就', '还', '又', '再', '很', '太', '非常', '比较', '有点']);

    for (const turn of userTurns) {
      const words = turn.content.split(/[\s，。！？、；：""''（）【】]+/);
      for (const word of words) {
        if (word.length >= 2 && !stopWords.has(word)) {
          wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
        }
      }
    }

    // 按频率排序，取 top-5
    const sorted = Array.from(wordFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    for (const [word, freq] of sorted) {
      if (freq >= 2) {
        topics.push(word);
      }
    }

    return topics;
  }

  /**
   * 分析情绪弧线
   */
  private analyzeEmotionArc(turns: ConversationTurn[]): string {
    const emotions = turns
      .filter(t => t.emotion)
      .map(t => ({
        emotion: t.emotion!.primary,
        intensity: t.emotion!.intensity,
        valence: t.emotion!.valence,
      }));

    if (emotions.length === 0) return '无明显情绪波动';

    // 识别情绪变化趋势
    const startValence = emotions[0].valence;
    const endValence = emotions[emotions.length - 1].valence;
    const valenceChange = endValence - startValence;

    // 识别主要情绪
    const emotionCounts = new Map<string, number>();
    for (const e of emotions) {
      emotionCounts.set(e.emotion, (emotionCounts.get(e.emotion) || 0) + 1);
    }
    const dominantEmotion = Array.from(emotionCounts.entries())
      .sort((a, b) => b[1] - a[1])[0][0];

    // 构建弧线描述
    let arcDesc = `主要情绪：${dominantEmotion}`;

    if (valenceChange > 0.3) {
      arcDesc += '，整体呈上升趋势（从消极转向积极）';
    } else if (valenceChange < -0.3) {
      arcDesc += '，整体呈下降趋势（从积极转向消极）';
    } else {
      arcDesc += '，整体保持平稳';
    }

    // 识别情绪波动
    let volatility = 0;
    for (let i = 1; i < emotions.length; i++) {
      volatility += Math.abs(emotions[i].valence - emotions[i - 1].valence);
    }
    volatility /= emotions.length;

    if (volatility > 0.4) {
      arcDesc += '，情绪波动较大';
    }

    return arcDesc;
  }

  /**
   * 识别关键转折点
   */
  private identifyTurningPoints(turns: ConversationTurn[]): string[] {
    const turningPoints: string[] = [];

    for (let i = 1; i < turns.length; i++) {
      const prev = turns[i - 1];
      const curr = turns[i];

      // 情绪突变
      if (prev.emotion && curr.emotion) {
        const valenceDiff = Math.abs(curr.emotion.valence - prev.emotion.valence);
        if (valenceDiff > 0.5) {
          turningPoints.push(`第${i + 1}轮：情绪从${prev.emotion.primary}转变为${curr.emotion.primary}`);
        }
      }

      // 用户主动纠正
      if (curr.role === 'user' && (
        curr.content.includes('不对') ||
        curr.content.includes('其实') ||
        curr.content.includes('不是这样')
      )) {
        turningPoints.push(`第${i + 1}轮：用户主动纠正或补充信息`);
      }

      // 新信息出现
      if (curr.role === 'user' && (
        curr.content.includes('我突然想到') ||
        curr.content.includes('对了') ||
        curr.content.includes('还有一个')
      )) {
        turningPoints.push(`第${i + 1}轮：用户主动提供新信息`);
      }
    }

    return turningPoints.slice(0, 5); // 最多 5 个转折点
  }

  /**
   * 提取新信息
   */
  private extractNewInformation(turns: ConversationTurn[]): string[] {
    const newInfo: string[] = [];
    const userTurns = turns.filter(t => t.role === 'user');

    for (const turn of userTurns) {
      const content = turn.content;

      // 识别"第一次提到"的信息
      if (content.includes('第一次') || content.includes('首次') || content.includes('以前没有')) {
        newInfo.push(content.substring(0, 100));
      }

      // 识别具体的数字信息
      const numbers = content.match(/\d+/g);
      if (numbers && numbers.length > 0) {
        newInfo.push(`包含数字信息：${content.substring(0, 80)}`);
      }

      // 识别时间信息
      if (content.includes('年') || content.includes('月') || content.includes('天')) {
        newInfo.push(`包含时间信息：${content.substring(0, 80)}`);
      }
    }

    return [...new Set(newInfo)].slice(0, 10);
  }

  /**
   * 提取行动项
   */
  private extractActionItems(turns: ConversationTurn[]): string[] {
    const actionItems: string[] = [];
    const assistantTurns = turns.filter(t => t.role === 'assistant');

    for (const turn of assistantTurns) {
      const content = turn.content;

      // 识别建议性语句
      if (content.includes('你可以试试') || content.includes('建议你')) {
        actionItems.push(content.substring(0, 100));
      }

      // 识别实验性建议
      if (content.includes('实验') || content.includes('尝试')) {
        actionItems.push(content.substring(0, 100));
      }
    }

    return [...new Set(actionItems)].slice(0, 5);
  }

  /**
   * 构建摘要文本
   */
  private buildSummaryText(
    topics: string[],
    emotionArc: string,
    turningPoints: string[],
    newInformation: string[]
  ): string {
    const parts: string[] = [];

    if (topics.length > 0) {
      parts.push(`本次对话主要围绕以下主题：${topics.join('、')}。`);
    }

    parts.push(`情绪状态：${emotionArc}。`);

    if (turningPoints.length > 0) {
      parts.push(`关键转折点：${turningPoints.join('；')}。`);
    }

    if (newInformation.length > 0) {
      parts.push(`新获取的信息：${newInformation.slice(0, 3).join('；')}。`);
    }

    return parts.join('');
  }

  /**
   * 识别新实体（价值观、约束、主题等）
   */
  private identifyNewEntities(
    turns: ConversationTurn[],
    newInformation: string[]
  ): Array<{ type: MemoryEntryType; content: string; confidence: number }> {
    const entities: Array<{ type: MemoryEntryType; content: string; confidence: number }> = [];
    const userTurns = turns.filter(t => t.role === 'user');

    for (const turn of userTurns) {
      const content = turn.content;

      // 识别价值观表达
      const valuePatterns = [
        { pattern: /对我来说(.+?)很重要/, type: 'value' as MemoryEntryType },
        { pattern: /我最看重(.+)/, type: 'value' as MemoryEntryType },
        { pattern: /我追求(.+)/, type: 'value' as MemoryEntryType },
      ];

      for (const { pattern, type } of valuePatterns) {
        const match = content.match(pattern);
        if (match) {
          entities.push({ type, content: match[1], confidence: 0.8 });
        }
      }

      // 识别约束表达
      const constraintPatterns = [
        { pattern: /我必须(.+)/, type: 'constraint' as MemoryEntryType },
        { pattern: /我不能(.+)/, type: 'constraint' as MemoryEntryType },
        { pattern: /(.+?)是硬性要求/, type: 'constraint' as MemoryEntryType },
      ];

      for (const { pattern, type } of constraintPatterns) {
        const match = content.match(pattern);
        if (match) {
          entities.push({ type, content: match[1], confidence: 0.7 });
        }
      }

      // 识别反复出现的主题
      const themePatterns = [
        { pattern: /我总是(.+)/, type: 'theme' as MemoryEntryType },
        { pattern: /每次(.+?)我都会/, type: 'theme' as MemoryEntryType },
        { pattern: /我一直(.+)/, type: 'theme' as MemoryEntryType },
      ];

      for (const { pattern, type } of themePatterns) {
        const match = content.match(pattern);
        if (match) {
          entities.push({ type, content: match[1], confidence: 0.75 });
        }
      }
    }

    return entities;
  }

  /**
   * 计算会话统计
   */
  private calculateSessionStats(turns: ConversationTurn[]): SessionSummaryResult['sessionStats'] {
    const userTurns = turns.filter(t => t.role === 'user');
    const emotions = turns.filter(t => t.emotion).map(t => t.emotion!);

    // 识别主要情绪
    const emotionCounts = new Map<string, number>();
    for (const e of emotions) {
      emotionCounts.set(e.primary, (emotionCounts.get(e.primary) || 0) + 1);
    }
    const dominantEmotion = emotionCounts.size > 0
      ? Array.from(emotionCounts.entries()).sort((a, b) => b[1] - a[1])[0][0]
      : '未知';

    // 计算情绪轨迹
    let emotionTrajectory = '平稳';
    if (emotions.length >= 2) {
      const startValence = emotions[0].valence;
      const endValence = emotions[emotions.length - 1].valence;
      if (endValence - startValence > 0.3) emotionTrajectory = '上升';
      else if (startValence - endValence > 0.3) emotionTrajectory = '下降';
    }

    // 计算时长
    const firstTimestamp = turns[0]?.timestamp ? new Date(turns[0].timestamp).getTime() : Date.now();
    const lastTimestamp = turns[turns.length - 1]?.timestamp ? new Date(turns[turns.length - 1].timestamp).getTime() : Date.now();
    const durationSeconds = Math.round((lastTimestamp - firstTimestamp) / 1000);

    return {
      total_turns: turns.length,
      user_turns: userTurns.length,
      duration_seconds: durationSeconds,
      dominant_emotion: dominantEmotion,
      emotion_trajectory: emotionTrajectory,
    };
  }
}
