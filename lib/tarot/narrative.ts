/**
 * 塔罗破冰模块 - 叙事线索检测
 *
 * 检测跨会话的牌面叙事线索
 * 将多张牌的情感轨迹串联为一条隐性叙事
 */

import {
  TarotInteraction, NarrativeArc, NarrativePoint,
  TarotProfile, CardId,
} from './types';
import { getCardById, MAJOR_ARCANA } from './card-data';

// ==================== 叙事检测器 ====================

export class NarrativeDetector {
  /**
   * 检测用户的塔罗叙事弧线
   */
  detect(profile: TarotProfile): NarrativeArc | null {
    const { interactions } = profile;

    // 至少需要2次交互才能检测叙事
    if (interactions.length < 2) {
      return null;
    }

    // 按时间排序
    const sortedInteractions = [...interactions].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // 构建叙事点
    const arc: NarrativePoint[] = sortedInteractions.map(interaction => {
      const card = getCardById(interaction.card);
      return {
        card: interaction.card,
        cardChinese: interaction.cardChinese,
        valence: card?.emotionProfile.valence || 0,
        arousal: card?.emotionProfile.arousal || 0,
        userReaction: interaction.userReaction,
        timestamp: interaction.timestamp,
        sessionId: interaction.sessionId,
      };
    });

    // 检测趋势
    const trend = this.detectTrend(arc);

    // 生成叙事文本
    const narrativeText = this.generateNarrativeText(arc, trend);

    return {
      arc,
      trend,
      narrativeText,
      detectedAt: new Date().toISOString(),
    };
  }

  /**
   * 检测情绪趋势
   */
  private detectTrend(arc: NarrativePoint[]): NarrativeArc['trend'] {
    if (arc.length < 3) {
      return 'unclear';
    }

    const valences = arc.map(p => p.valence);

    // 计算线性回归斜率
    const slope = this.calculateSlope(valences);

    // 计算波动性
    const volatility = this.calculateVolatility(valences);

    if (volatility > 0.4) {
      return 'fluctuating';
    }

    if (slope > 0.15) {
      return 'improving';
    }

    if (slope < -0.15) {
      return 'declining';
    }

    return 'unclear';
  }

  /**
   * 生成叙事文本
   */
  private generateNarrativeText(
    arc: NarrativePoint[],
    trend: NarrativeArc['trend']
  ): string {
    if (arc.length < 2) {
      return '叙事尚不完整';
    }

    const parts: string[] = [];

    // 描述牌面序列
    const cardSequence = arc.map(p => p.cardChinese).join(' → ');
    parts.push(`牌面序列：${cardSequence}`);

    // 描述趋势
    switch (trend) {
      case 'improving':
        parts.push('整体向积极方向发展');
        break;
      case 'declining':
        parts.push('整体向消极方向发展');
        break;
      case 'fluctuating':
        parts.push('情绪起伏不定');
        break;
      case 'unclear':
        parts.push('趋势尚不明确');
        break;
    }

    // 描述用户反应模式
    const positiveReactions = arc.filter(p =>
      p.userReaction === 'very_much' || p.userReaction === 'somewhat'
    ).length;
    const negativeReactions = arc.filter(p =>
      p.userReaction === 'not_at_all'
    ).length;

    if (positiveReactions > negativeReactions) {
      parts.push('用户对牌面有较多共鸣');
    } else if (negativeReactions > positiveReactions) {
      parts.push('用户对牌面共鸣较少');
    }

    return parts.join('。');
  }

  /**
   * 计算线性回归斜率
   */
  private calculateSlope(values: number[]): number {
    const n = values.length;
    if (n < 2) return 0;

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumX2 += i * i;
    }

    return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  }

  /**
   * 计算波动性（标准差）
   */
  private calculateVolatility(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  /**
   * 生成复盘话术
   */
  generateReviewPrompt(profile: TarotProfile): string | null {
    const arc = this.detect(profile);
    if (!arc || arc.arc.length < 3) {
      return null;
    }

    const cardNames = arc.arc.map(p => p.cardChinese);
    const firstCard = cardNames[0];
    const lastCard = cardNames[cardNames.length - 1];

    let prompt = `你之前抽到过几次牌——`;
    prompt += `第一次是${firstCard}，`;

    if (cardNames.length >= 3) {
      const middleCard = cardNames[Math.floor(cardNames.length / 2)];
      prompt += `后来是${middleCard}，`;
    }

    prompt += `最近一次是${lastCard}。`;

    switch (arc.trend) {
      case 'improving':
        prompt += `\n\n你自己觉得，这个变化像你最近的状态吗？看起来是在往好的方向走。`;
        break;
      case 'declining':
        prompt += `\n\n你自己觉得，这个变化像你最近的状态吗？如果需要聊聊，我在这里。`;
        break;
      case 'fluctuating':
        prompt += `\n\n你自己觉得，这个变化像你最近的状态吗？看起来有些起伏。`;
        break;
      default:
        prompt += `\n\n你自己觉得，这个变化像你最近的状态吗？`;
    }

    return prompt;
  }
}

// ==================== 隐喻线索管理 ====================

export class MetaphorManager {
  /**
   * 从塔罗交互中提取隐喻线索
   */
  extractMetaphorClues(interactions: TarotInteraction[]): Array<{
    metaphor: string;
    source: string;
    confidence: number;
    timestamp: string;
  }> {
    const clues: Array<{
      metaphor: string;
      source: string;
      confidence: number;
      timestamp: string;
    }> = [];

    for (const interaction of interactions) {
      // 从隐喻标签提取
      for (const tag of interaction.metaphorTags) {
        clues.push({
          metaphor: tag,
          source: `塔罗牌：${interaction.cardChinese}`,
          confidence: this.calculateMetaphorConfidence(interaction),
          timestamp: interaction.timestamp,
        });
      }

      // 从用户表达中提取
      if (interaction.followUpExpression) {
        const extractedMetaphors = this.extractMetaphorsFromText(
          interaction.followUpExpression
        );
        for (const metaphor of extractedMetaphors) {
          clues.push({
            metaphor,
            source: `用户表达（塔罗牌：${interaction.cardChinese}）`,
            confidence: 0.6,
            timestamp: interaction.timestamp,
          });
        }
      }
    }

    // 去重并按置信度排序
    return this.deduplicateAndSort(clues);
  }

  /**
   * 计算隐喻置信度
   */
  private calculateMetaphorConfidence(interaction: TarotInteraction): number {
    let confidence = 0.5;

    // 用户反应越强烈，置信度越高
    switch (interaction.userReaction) {
      case 'very_much': confidence = 0.9; break;
      case 'somewhat': confidence = 0.7; break;
      case 'not_really': confidence = 0.3; break;
      case 'not_at_all': confidence = 0.1; break;
    }

    // 有后续表达，置信度提升
    if (interaction.followUpExpression && interaction.followUpExpression.length > 10) {
      confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  }

  /**
   * 从文本中提取隐喻
   */
  private extractMetaphorsFromText(text: string): string[] {
    const metaphors: string[] = [];

    // 常见隐喻模式
    const metaphorPatterns = [
      { pattern: /像(.{2,8})一样/, group: 1 },
      /好像(.{2,10})/,
      /感觉(.{2,10})/,
      /(.{2,6})的感觉/,
    ];

    for (const pattern of metaphorPatterns) {
      const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern.pattern);
      const match = text.match(regex);
      if (match) {
        const groupIndex = pattern instanceof RegExp ? 0 : (pattern.group || 0);
        metaphors.push(match[groupIndex || 0]);
      }
    }

    return metaphors.filter(m => m && m.length >= 2 && m.length <= 10);
  }

  /**
   * 去重并排序
   */
  private deduplicateAndSort(
    clues: Array<{ metaphor: string; source: string; confidence: number; timestamp: string }>
  ): Array<{ metaphor: string; source: string; confidence: number; timestamp: string }> {
    const metaphorMap = new Map<string, typeof clues[0]>();

    for (const clue of clues) {
      const existing = metaphorMap.get(clue.metaphor);
      if (!existing || clue.confidence > existing.confidence) {
        metaphorMap.set(clue.metaphor, clue);
      }
    }

    return Array.from(metaphorMap.values())
      .sort((a, b) => b.confidence - a.confidence);
  }
}
