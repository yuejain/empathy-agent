/**
 * 情绪轨迹追踪器
 * 记录每轮对话的情绪、强度、效价、唤醒度
 * 计算情绪趋势（declining/stable/escalating）
 * 基于轨迹推荐共情策略
 */

import { Emotion } from './emotion-tags';

// 情绪记录
export interface EmotionRecord {
  timestamp: number;
  emotion: Emotion;
  intensity: number;
  valence: number;
  arousal: number;
  dominance: number;
  userInput: string;
  conversationId: string;
}

// 情绪趋势
export type EmotionTrend = 'declining' | 'stable' | 'escalating' | 'fluctuating';

// 情绪轨迹分析结果
export interface EmotionTrajectoryAnalysis {
  trend: EmotionTrend;
  averageIntensity: number;
  averageValence: number;
  averageArousal: number;
  volatility: number;          // 情绪波动性
  duration: number;            // 情绪持续时间（毫秒）
  recommendedStrategy: string;
  riskFactors: string[];
}

// 情绪状态机
export type EmotionState = 
  | 'crisis'           // 危机状态
  | 'acute_distress'   // 急性痛苦
  | 'chronic_distress' // 慢性痛苦
  | 'neutral'          // 中性状态
  | 'positive'         // 积极状态
  | 'recovery'         // 恢复中
  | 'growth';          // 成长中

export class EmotionTracker {
  private records: Map<string, EmotionRecord[]> = new Map();
  private stateMachines: Map<string, EmotionState> = new Map();

  // 记录情绪
  recordEmotion(
    conversationId: string,
    userInput: string,
    emotion: Emotion,
    intensity: number,
    valence: number,
    arousal: number,
    dominance: number
  ): void {
    const record: EmotionRecord = {
      timestamp: Date.now(),
      emotion,
      intensity,
      valence,
      arousal,
      dominance,
      userInput,
      conversationId
    };

    if (!this.records.has(conversationId)) {
      this.records.set(conversationId, []);
    }

    this.records.get(conversationId)!.push(record);
    
    // 更新情绪状态机
    this.updateEmotionState(conversationId, record);
    
    // 保持记录数量在合理范围内（最近100条）
    const records = this.records.get(conversationId)!;
    if (records.length > 100) {
      records.splice(0, records.length - 100);
    }
  }

  // 获取情绪轨迹分析
  analyzeTrajectory(conversationId: string): EmotionTrajectoryAnalysis {
    const records = this.records.get(conversationId) || [];
    
    if (records.length === 0) {
      return this.getDefaultAnalysis();
    }

    // 计算基本统计
    const intensities = records.map(r => r.intensity);
    const valences = records.map(r => r.valence);
    const arousals = records.map(r => r.arousal);
    
    const averageIntensity = this.average(intensities);
    const averageValence = this.average(valences);
    const averageArousal = this.average(arousals);
    
    // 计算波动性（标准差）
    const volatility = this.calculateVolatility(intensities);
    
    // 计算趋势
    const trend = this.calculateTrend(records);
    
    // 计算持续时间
    const duration = records.length > 1 ? 
      records[records.length - 1].timestamp - records[0].timestamp : 0;
    
    // 推荐策略
    const recommendedStrategy = this.recommendStrategy(trend, averageIntensity, averageValence);
    
    // 识别风险因素
    const riskFactors = this.identifyRiskFactors(records);

    return {
      trend,
      averageIntensity,
      averageValence,
      averageArousal,
      volatility,
      duration,
      recommendedStrategy,
      riskFactors
    };
  }

  // 获取当前情绪状态
  getCurrentState(conversationId: string): EmotionState {
    return this.stateMachines.get(conversationId) || 'neutral';
  }

  // 获取最近N条记录
  getRecentRecords(conversationId: string, count: number): EmotionRecord[] {
    const records = this.records.get(conversationId) || [];
    return records.slice(-count);
  }

  // 获取情绪历史
  getEmotionHistory(conversationId: string): EmotionRecord[] {
    return this.records.get(conversationId) || [];
  }

  // 清除对话记录
  clearConversation(conversationId: string): void {
    this.records.delete(conversationId);
    this.stateMachines.delete(conversationId);
  }

  // 更新情绪状态机
  private updateEmotionState(conversationId: string, record: EmotionRecord): void {
    const currentState = this.stateMachines.get(conversationId) || 'neutral';
    const newState = this.determineNewState(currentState, record);
    this.stateMachines.set(conversationId, newState);
  }

  // 确定新状态
  private determineNewState(currentState: EmotionState, record: EmotionRecord): EmotionState {
    const { intensity, valence, arousal } = record;
    
    // 危机检测
    if (this.isCrisisSignal(record)) {
      return 'crisis';
    }
    
    // 基于效价和强度的状态判断
    if (valence < -0.7 && intensity > 0.7) {
      return 'acute_distress';
    }
    
    if (valence < -0.3 && intensity > 0.5) {
      return 'chronic_distress';
    }
    
    if (valence > 0.3 && intensity > 0.5) {
      return 'positive';
    }
    
    if (valence > 0.1 && currentState === 'chronic_distress') {
      return 'recovery';
    }
    
    if (valence > 0.5 && intensity > 0.6) {
      return 'growth';
    }
    
    // 默认保持当前状态或返回中性
    if (currentState === 'crisis' || currentState === 'acute_distress') {
      // 从危机状态需要更多积极信号才能转换
      if (valence > 0.5 && intensity < 0.5) {
        return 'recovery';
      }
      return currentState;
    }
    
    return 'neutral';
  }

  // 检测危机信号
  private isCrisisSignal(record: EmotionRecord): boolean {
    const crisisKeywords = [
      '自杀', '不想活', '活着没意思', '死了算了', '结束生命',
      '自残', '伤害自己', '割腕', '跳楼', '上吊',
      '没有出路', '永远不会好', '绝望', '解脱'
    ];
    
    const input = record.userInput.toLowerCase();
    return crisisKeywords.some(keyword => input.includes(keyword));
  }

  // 计算趋势
  private calculateTrend(records: EmotionRecord[]): EmotionTrend {
    if (records.length < 3) {
      return 'stable';
    }
    
    // 取最近5条记录
    const recent = records.slice(-5);
    const valences = recent.map(r => r.valence);
    
    // 计算线性回归斜率
    const slope = this.calculateSlope(valences);
    
    // 计算波动性
    const volatility = this.calculateVolatility(valences);
    
    if (volatility > 0.3) {
      return 'fluctuating';
    }
    
    if (slope > 0.1) {
      return 'escalating'; // 情绪在改善
    }
    
    if (slope < -0.1) {
      return 'declining'; // 情绪在恶化
    }
    
    return 'stable';
  }

  // 计算线性回归斜率
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
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return slope;
  }

  // 计算波动性（标准差）
  private calculateVolatility(values: number[]): number {
    if (values.length < 2) return 0;
    
    const mean = this.average(values);
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = this.average(squaredDiffs);
    
    return Math.sqrt(variance);
  }

  // 推荐策略
  private recommendStrategy(
    trend: EmotionTrend,
    averageIntensity: number,
    averageValence: number
  ): string {
    // 危机状态
    if (trend === 'declining' && averageIntensity > 0.8 && averageValence < -0.7) {
      return '安全优先：立即评估危机程度，提供紧急资源';
    }
    
    // 急性痛苦
    if (averageIntensity > 0.7 && averageValence < -0.5) {
      return '情绪命名+验证：帮助用户识别和表达情绪，验证其合理性';
    }
    
    // 慢性痛苦
    if (averageIntensity > 0.5 && averageValence < -0.3) {
      return '正常化+去标签化：说明这种感受的普遍性，减少病耻感';
    }
    
    // 恢复中
    if (trend === 'escalating' && averageValence > -0.2) {
      return '深度共情+镜像：反映用户的进步，增强自我效能感';
    }
    
    // 积极状态
    if (averageValence > 0.3) {
      return '温和推进+行动实验：探索成长机会，鼓励积极行动';
    }
    
    // 默认策略
    return '情绪命名+验证：帮助用户识别当前感受';
  }

  // 识别风险因素
  private identifyRiskFactors(records: EmotionRecord[]): string[] {
    const riskFactors: string[] = [];
    
    // 检查长期负面情绪
    const recentNegative = records.slice(-10).filter(r => r.valence < -0.3);
    if (recentNegative.length > 7) {
      riskFactors.push('长期负面情绪');
    }
    
    // 检查情绪波动
    const valences = records.slice(-10).map(r => r.valence);
    if (this.calculateVolatility(valences) > 0.4) {
      riskFactors.push('情绪波动剧烈');
    }
    
    // 检查高强度负面情绪
    const highIntensityNegative = records.slice(-5).filter(
      r => r.intensity > 0.7 && r.valence < -0.5
    );
    if (highIntensityNegative.length > 2) {
      riskFactors.push('高强度负面情绪');
    }
    
    // 检查危机关键词
    const crisisRecords = records.filter(r => this.isCrisisSignal(r));
    if (crisisRecords.length > 0) {
      riskFactors.push('存在危机信号');
    }
    
    return riskFactors;
  }

  // 计算平均值
  private average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  // 获取默认分析结果
  private getDefaultAnalysis(): EmotionTrajectoryAnalysis {
    return {
      trend: 'stable',
      averageIntensity: 0.5,
      averageValence: 0.0,
      averageArousal: 0.5,
      volatility: 0.0,
      duration: 0,
      recommendedStrategy: '情绪命名+验证：帮助用户识别当前感受',
      riskFactors: []
    };
  }
}

// 情绪状态转换矩阵
export const STATE_TRANSITION_MATRIX: Record<EmotionState, Partial<Record<EmotionState, number>>> = {
  crisis: {
    crisis: 0.8,
    acute_distress: 0.15,
    recovery: 0.05
  },
  acute_distress: {
    crisis: 0.1,
    acute_distress: 0.6,
    chronic_distress: 0.2,
    recovery: 0.1
  },
  chronic_distress: {
    acute_distress: 0.1,
    chronic_distress: 0.6,
    neutral: 0.2,
    recovery: 0.1
  },
  neutral: {
    chronic_distress: 0.1,
    neutral: 0.6,
    positive: 0.2,
    growth: 0.1
  },
  positive: {
    neutral: 0.2,
    positive: 0.6,
    growth: 0.2
  },
  recovery: {
    chronic_distress: 0.1,
    neutral: 0.3,
    positive: 0.4,
    growth: 0.2
  },
  growth: {
    positive: 0.3,
    growth: 0.7
  }
};

// 获取状态转换概率
export function getTransitionProbability(
  fromState: EmotionState,
  toState: EmotionState
): number {
  return STATE_TRANSITION_MATRIX[fromState]?.[toState] || 0;
}