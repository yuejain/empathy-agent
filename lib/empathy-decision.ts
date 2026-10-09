/**
 * 共情决策引擎
 * 五层共情层级选择决策矩阵
 * 结构化推理链的共情响应生成Prompt
 */

import { Emotion } from './emotion-tags';
import { EmotionRecognitionResult } from './emotion-recognition';
import { EmotionTrajectoryAnalysis, EmotionState } from './emotion-tracker';

// 共情层级
export type EmpathyLevel = 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

// 共情策略
export interface EmpathyStrategy {
  level: EmpathyLevel;
  name: string;
  description: string;
  techniques: string[];
  promptTemplate: string;
  safetyConsiderations: string[];
}

// 共情决策结果
export interface EmpathyDecision {
  level: EmpathyLevel;
  strategy: EmpathyStrategy;
  reasoning: string;
  safetyFlags: string[];
  immediateActions: string[];
}

// 共情策略定义
export const EMPATHY_STRATEGIES: Record<EmpathyLevel, EmpathyStrategy> = {
  L1: {
    level: 'L1',
    name: '安全优先',
    description: '危机检测与安全协议',
    techniques: [
      '评估自杀/自残风险',
      '提供紧急资源',
      '设定安全边界',
      '保持冷静和专业'
    ],
    promptTemplate: `你正在处理一个可能处于危机状态的用户。请按照以下步骤响应：

1. **安全评估**：识别具体的危机信号
2. **紧急资源**：提供当地的心理健康热线或紧急联系方式
3. **安全边界**：明确表示你关心他们的安全
4. **专业转介**：建议寻求专业帮助

用户输入：{userInput}
情绪分析：{emotionAnalysis}

请以安全和支持性的方式回应。`,
    safetyConsiderations: [
      '不要承诺保密（如果存在自杀风险）',
      '不要提供具体的自杀方法',
      '不要最小化用户的痛苦',
      '保持专业边界'
    ]
  },
  L2: {
    level: 'L2',
    name: '情绪命名+验证',
    description: '帮助用户识别和表达情绪',
    techniques: [
      '准确命名情绪',
      '验证情绪的合理性',
      '使用用户的原话',
      '避免评判'
    ],
    promptTemplate: `请帮助用户识别和验证他们的情绪。按照以下结构：

1. **反映**（1-2句）：复述用户的核心内容和情绪，使用用户原话中的关键词
2. **验证**（1句）：解释为什么这种感受是合理的

用户输入：{userInput}
识别的情绪：{primaryEmotion}（强度：{intensity}）
情绪背景：{emotionContext}

请用温暖、理解的语气回应。`,
    safetyConsiderations: [
      '不要质疑情绪的真实性',
      '不要使用"但是"来弱化验证',
      '避免过早给出建议'
    ]
  },
  L3: {
    level: 'L3',
    name: '正常化+去标签化',
    description: '说明感受的普遍性，减少病耻感',
    techniques: [
      '说明很多人都有类似感受',
      '避免病理化标签',
      '提供希望和视角',
      '鼓励自我同情'
    ],
    promptTemplate: `请帮助用户正常化他们的感受。按照以下结构：

1. **反映+验证**：如L2所述
2. **正常化**（1句）：说明很多人都会这样，这是人类体验的一部分
3. **去标签化**：避免使用病理化语言，强调这是暂时的状态

用户输入：{userInput}
情绪分析：{emotionAnalysis}
用户可能的自我标签：{selfLabels}

请用支持性和正常化的语气回应。`,
    safetyConsiderations: [
      '不要使用"你这是抑郁症"等诊断语言',
      '不要比较痛苦（"别人更惨"）',
      '不要提供虚假的安慰'
    ]
  },
  L4: {
    level: 'L4',
    name: '深度共情+镜像',
    description: '反映用户的内在体验，增强自我理解',
    techniques: [
      '反映深层感受',
      '镜像情感体验',
      '探索情绪背后的需求',
      '增强自我觉察'
    ],
    promptTemplate: `请提供深度共情。按照以下结构：

1. **反映+验证**：如L2所述
2. **深度共情**：探索情绪背后的可能原因或需求
3. **镜像**：反映用户可能没有明说的深层感受

用户输入：{userInput}
情绪分析：{emotionAnalysis}
情绪历史：{emotionHistory}
可能的需求：{possibleNeeds}

请用深刻理解和共情的语气回应。`,
    safetyConsiderations: [
      '不要过度解读',
      '保持谦逊和好奇',
      '尊重用户的自我认知'
    ]
  },
  L5: {
    level: 'L5',
    name: '温和推进+行动实验',
    description: '探索改变的可能性，鼓励小步骤行动',
    techniques: [
      '探索改变的意愿',
      '提供小而可行的建议',
      '鼓励自我实验',
      '庆祝小进步'
    ],
    promptTemplate: `请温和地推进用户的成长。按照以下结构：

1. **反映+验证**：如L2所述
2. **温和推进**：问一个低门槛的问题，探索改变的意愿
3. **行动实验**：如果用户准备好了，建议一个小的、可尝试的行动

用户输入：{userInput}
情绪分析：{emotionAnalysis}
情绪趋势：{emotionTrend}
用户准备度：{readinessLevel}

请用支持性和鼓励性的语气回应。确保建议是小而可行的。`,
    safetyConsiderations: [
      '不要强迫改变',
      '尊重用户的节奏',
      '提供选择而非指令'
    ]
  }
};

// 特殊情绪处理策略
export const SPECIAL_EMOTION_STRATEGIES: Record<string, {
  strategy: string;
  considerations: string[];
}> = {
  'numbness': {
    strategy: '不急于命名情绪，先建立连接。尝试探索麻木背后的感受，可能是保护机制。',
    considerations: [
      '不要强迫感受',
      '提供安全的空间',
      '探索麻木的可能原因'
    ]
  },
  'ambivalence': {
    strategy: '先呈现两面，不做取舍建议。帮助用户看到矛盾的两面，促进自我理解。',
    considerations: [
      '不要急于解决矛盾',
      '尊重复杂性',
      '促进自我探索'
    ]
  },
  'fear_and_desire': {
    strategy: '引导看到期待的一面，同时承认恐惧。帮助用户平衡两种感受。',
    considerations: [
      '不要最小化恐惧',
      '探索期待的价值',
      '帮助制定安全计划'
    ]
  }
};

export class EmpathyDecisionEngine {
  /** The orchestrator owns phase/risk decisions; reuse one strategy table without a second competing state machine. */
  guidance(level: EmpathyLevel, emotionId: string): string {
    const strategy = EMPATHY_STRATEGIES[level], special = SPECIAL_EMOTION_STRATEGIES[emotionId];
    return `回应策略：${strategy.name}；${strategy.techniques.slice(0,2).join('、')}。${special ? special.strategy : ''} 用户当前请求和已选择的回应方向优先。`;
  }
  // 根据情绪状态选择共情层级
  selectEmpathyLevel(
    emotionResult: EmotionRecognitionResult,
    trajectoryAnalysis: EmotionTrajectoryAnalysis,
    currentState: EmotionState
  ): EmpathyLevel {
    const { intensity, valence } = emotionResult;
    const { trend, riskFactors } = trajectoryAnalysis;
    
    // L1: 危机检测
    if (
      currentState === 'crisis' ||
      riskFactors.includes('存在危机信号') ||
      (intensity > 0.9 && valence < -0.8)
    ) {
      return 'L1';
    }
    
    // L2: 高强度负面情绪
    if (
      intensity > 0.7 && valence < -0.5 &&
      (trend === 'declining' || trend === 'fluctuating')
    ) {
      return 'L2';
    }
    
    // L3: 中等负面情绪
    if (
      intensity > 0.5 && valence < -0.3 &&
      trend !== 'escalating'
    ) {
      return 'L3';
    }
    
    // L4: 情绪改善或探索阶段
    if (
      (trend === 'escalating' || trend === 'stable') &&
      valence > -0.3 && valence < 0.3
    ) {
      return 'L4';
    }
    
    // L5: 积极状态或准备改变
    if (
      valence > 0.3 || 
      (trend === 'escalating' && intensity < 0.6)
    ) {
      return 'L5';
    }
    
    // 默认L2
    return 'L2';
  }

  // 做出共情决策
  makeDecision(
    emotionResult: EmotionRecognitionResult,
    trajectoryAnalysis: EmotionTrajectoryAnalysis,
    currentState: EmotionState,
    userInput: string
  ): EmpathyDecision {
    const level = this.selectEmpathyLevel(emotionResult, trajectoryAnalysis, currentState);
    const strategy = EMPATHY_STRATEGIES[level];
    
    // 检查特殊情绪
    const specialStrategy = SPECIAL_EMOTION_STRATEGIES[emotionResult.primaryEmotion.id];
    
    // 生成推理过程
    const reasoning = this.generateReasoning(
      emotionResult,
      trajectoryAnalysis,
      currentState,
      level,
      specialStrategy
    );
    
    // 识别安全标志
    const safetyFlags = this.identifySafetyFlags(emotionResult, trajectoryAnalysis, currentState);
    
    // 确定即时行动
    const immediateActions = this.determineImmediateActions(level, safetyFlags, specialStrategy);
    
    return {
      level,
      strategy: specialStrategy ? {
        ...strategy,
        description: `${strategy.description} + ${specialStrategy.strategy}`
      } : strategy,
      reasoning,
      safetyFlags,
      immediateActions
    };
  }

  // 生成共情响应提示词
  generateEmpathyPrompt(
    decision: EmpathyDecision,
    emotionResult: EmotionRecognitionResult,
    trajectoryAnalysis: EmotionTrajectoryAnalysis,
    userInput: string,
    conversationHistory: string[] = []
  ): string {
    const { strategy } = decision;
    
    // 基础变量
    const variables: Record<string, string> = {
      userInput,
      primaryEmotion: emotionResult.primaryEmotion.name,
      intensity: emotionResult.intensity.toFixed(2),
      emotionContext: emotionResult.contextualFactors.join('、'),
      emotionAnalysis: this.formatEmotionAnalysis(emotionResult),
      emotionHistory: this.formatEmotionHistory(conversationHistory),
      emotionTrend: trajectoryAnalysis.trend,
      possibleNeeds: this.inferPossibleNeeds(emotionResult),
      readinessLevel: this.assessReadinessLevel(emotionResult, trajectoryAnalysis),
      selfLabels: this.extractSelfLabels(userInput).join('、')
    };
    
    // 替换模板变量
    let prompt = strategy.promptTemplate;
    for (const [key, value] of Object.entries(variables)) {
      prompt = prompt.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }
    
    // 添加特殊策略说明
    const specialStrategy = SPECIAL_EMOTION_STRATEGIES[emotionResult.primaryEmotion.id];
    if (specialStrategy) {
      prompt += `\n\n特殊处理说明：${specialStrategy.strategy}`;
      prompt += `\n注意事项：${specialStrategy.considerations.join('、')}`;
    }
    
    // 添加安全注意事项
    if (decision.safetyFlags.length > 0) {
      prompt += `\n\n安全警告：${decision.safetyFlags.join('、')}`;
    }
    
    return prompt;
  }

  // 格式化情绪分析
  private formatEmotionAnalysis(result: EmotionRecognitionResult): string {
    return `主要情绪：${result.primaryEmotion.name}（${result.primaryEmotion.description}）
强度：${result.intensity.toFixed(2)} 
效价：${result.valence.toFixed(2)} 
唤醒度：${result.arousal.toFixed(2)}
支配度：${result.dominance.toFixed(2)}
置信度：${result.confidence.toFixed(2)}`;
  }

  // 格式化情绪历史
  private formatEmotionHistory(history: string[]): string {
    if (history.length === 0) return '无历史记录';
    return history.slice(-5).join('\n');
  }

  // 推断可能的需求
  private inferPossibleNeeds(result: EmotionRecognitionResult): string {
    const emotion = result.primaryEmotion.id;
    
    const needsMap: Record<string, string> = {
      'anxiety': '安全感、确定性、控制感',
      'sadness': '安慰、支持、理解',
      'anger': '公平、尊重、边界',
      'fear': '安全、保护、 reassurance',
      'shame': '接纳、价值感、尊严',
      'loneliness': '连接、归属感、被看见',
      'helplessness': '赋能、支持、希望',
      'confusion': '清晰、方向、理解',
      'disappointment': 'validation、希望、新视角',
      'frustration': '进展、成就感、支持'
    };
    
    return needsMap[emotion] || '理解、支持、连接';
  }

  // 评估准备度
  private assessReadinessLevel(
    result: EmotionRecognitionResult,
    analysis: EmotionTrajectoryAnalysis
  ): string {
    const { intensity, valence } = result;
    const { trend } = analysis;
    
    if (intensity > 0.8 || valence < -0.7) {
      return '低准备度（需要情感支持）';
    }
    
    if (trend === 'escalating' && valence > -0.3) {
      return '中等准备度（可以探索改变）';
    }
    
    if (valence > 0.3 && intensity < 0.6) {
      return '高准备度（可以尝试行动）';
    }
    
    return '中等准备度（需要平衡支持与挑战）';
  }

  // 提取自我标签
  private extractSelfLabels(userInput: string): string[] {
    const labels: string[] = [];
    const labelPatterns = [
      { pattern: /我是(.{2,10})的人/, group: 1 },
      { pattern: /我总是(.{2,10})/, group: 1 },
      { pattern: /我从来(.{2,10})/, group: 1 },
      { pattern: /我太(.{2,10})了/, group: 1 }
    ];
    
    labelPatterns.forEach(({ pattern, group }) => {
      const match = userInput.match(pattern);
      if (match && match[group]) {
        labels.push(match[group]);
      }
    });
    
    return labels;
  }

  // 生成推理过程
  private generateReasoning(
    emotionResult: EmotionRecognitionResult,
    trajectoryAnalysis: EmotionTrajectoryAnalysis,
    currentState: EmotionState,
    level: EmpathyLevel,
    specialStrategy?: { strategy: string; considerations: string[] }
  ): string {
    const parts: string[] = [];
    
    parts.push(`情绪分析：${emotionResult.primaryEmotion.name}，强度${emotionResult.intensity.toFixed(2)}，效价${emotionResult.valence.toFixed(2)}`);
    parts.push(`情绪趋势：${trajectoryAnalysis.trend}，波动性${trajectoryAnalysis.volatility.toFixed(2)}`);
    parts.push(`当前状态：${currentState}`);
    parts.push(`选择层级：${level}（${EMPATHY_STRATEGIES[level].name}）`);
    
    if (specialStrategy) {
      parts.push(`特殊策略：${specialStrategy.strategy}`);
    }
    
    parts.push(`风险因素：${trajectoryAnalysis.riskFactors.length > 0 ? trajectoryAnalysis.riskFactors.join('、') : '无'}`);
    
    return parts.join('\n');
  }

  // 识别安全标志
  private identifySafetyFlags(
    emotionResult: EmotionRecognitionResult,
    trajectoryAnalysis: EmotionTrajectoryAnalysis,
    currentState: EmotionState
  ): string[] {
    const flags: string[] = [];
    
    // 危机信号
    if (currentState === 'crisis' || trajectoryAnalysis.riskFactors.includes('存在危机信号')) {
      flags.push('检测到危机信号');
    }
    
    // 高强度负面情绪
    if (emotionResult.intensity > 0.9 && emotionResult.valence < -0.8) {
      flags.push('高强度负面情绪');
    }
    
    // 情绪恶化趋势
    if (trajectoryAnalysis.trend === 'declining' && trajectoryAnalysis.volatility > 0.3) {
      flags.push('情绪恶化且波动剧烈');
    }
    
    // 长期负面情绪
    if (trajectoryAnalysis.riskFactors.includes('长期负面情绪')) {
      flags.push('长期负面情绪状态');
    }
    
    return flags;
  }

  // 确定即时行动
  private determineImmediateActions(
    level: EmpathyLevel,
    safetyFlags: string[],
    specialStrategy?: { strategy: string; considerations: string[] }
  ): string[] {
    const actions: string[] = [];
    
    // 危机处理
    if (safetyFlags.includes('检测到危机信号')) {
      actions.push('评估自杀/自残风险');
      actions.push('提供紧急联系方式');
      actions.push('建议寻求专业帮助');
    }
    
    // 基于层级的行动
    switch (level) {
      case 'L1':
        actions.push('保持冷静和专业');
        actions.push('设定安全边界');
        break;
      case 'L2':
        actions.push('准确命名情绪');
        actions.push('验证情绪的合理性');
        break;
      case 'L3':
        actions.push('说明感受的普遍性');
        actions.push('避免病理化标签');
        break;
      case 'L4':
        actions.push('探索情绪背后的需求');
        actions.push('反映深层感受');
        break;
      case 'L5':
        actions.push('探索改变的意愿');
        actions.push('建议小步骤行动');
        break;
    }
    
    // 特殊策略行动
    if (specialStrategy) {
      actions.push(...specialStrategy.considerations);
    }
    
    return actions;
  }
}

// 输出过滤器
export class OutputFilter {
  /** Hold only prefixes of forbidden phrases so split tokens cannot bypass the filter. */
  streaming(empathyLevel: EmpathyLevel) {
    const rules = [ ...this.hardForbiddenPhrases.map(text => ({ text, replacement: '[已过滤]' })),
      ...(empathyLevel === 'L5' ? [] : this.softForbiddenPhrases.map(text => ({ text, replacement: '' }))) ];
    let pending = '';
    const drain = (final: boolean) => {
      let output = '';
      while (pending) {
        if (!final && rules.some(rule => rule.text.length > pending.length && rule.text.startsWith(pending))) break;
        const match = rules.find(rule => pending.startsWith(rule.text));
        if (match) { output += match.replacement; pending = pending.slice(match.text.length); continue; }
        if (!final && rules.some(rule => rule.text.startsWith(pending))) break;
        const char = String.fromCodePoint(pending.codePointAt(0)!);
        output += char; pending = pending.slice(char.length);
      }
      return output;
    };
    return { feed: (text: string) => { pending += text; return drain(false); }, finish: () => drain(true) };
  }
  private hardForbiddenPhrases: string[] = [
    // 病理化
    '你这是抑郁症', '你有焦虑症', '你患有', '你被诊断为',
    // 命运结论
    '你注定', '你命里', '你这辈子', '永远都不会',
    // 道德评判
    '你不该这样想', '你太消极了', '你不应该', '你错了',
    // 危机不当回应
    '一切都会好的', '想开点', '别想太多', '顺其自然',
    // 比惨
    '你这不算什么', '别人更惨', '比你惨的人', '至少你',
    // 诊断
    '你有病', '你需要治疗', '你应该吃药'
  ];

  private softForbiddenPhrases: string[] = [
    // 过早建议
    '你应该试试', '我建议你', '你需要', '你必须',
    // 空洞安慰
    '别想太多', '顺其自然', '时间会', '慢慢来',
    // 假装理解
    '我完全理解', '我感同身受', '我懂你', '我知道你的感受'
  ];

  private qualityMetrics = {
    hasUserKeywords: false,
    hasSpecificContext: false,
    avoidsEmptyOpening: false,
    hasProgressiveQuestion: false
  };

  // 过滤输出
  filterOutput(
    response: string,
    userInput: string,
    empathyLevel: EmpathyLevel,
    shouldProgress: boolean
  ): {
    filteredResponse: string;
    qualityScore: number;
    warnings: string[];
  } {
    let filteredResponse = response;
    const warnings: string[] = [];
    
    // 硬禁止短语过滤
    this.hardForbiddenPhrases.forEach(phrase => {
      if (filteredResponse.includes(phrase)) {
        filteredResponse = filteredResponse.replace(new RegExp(phrase, 'g'), '[已过滤]');
        warnings.push(`硬禁止短语被过滤：${phrase}`);
      }
    });
    
    // 软禁止短语过滤（在L5之前）
    if (empathyLevel !== 'L5') {
      this.softForbiddenPhrases.forEach(phrase => {
        if (filteredResponse.includes(phrase)) {
          filteredResponse = filteredResponse.replace(new RegExp(phrase, 'g'), '');
          warnings.push(`软禁止短语被过滤：${phrase}`);
        }
      });
    }
    
    // 质量评估
    const qualityScore = this.assessQuality(filteredResponse, userInput, shouldProgress);
    
    return {
      filteredResponse,
      qualityScore,
      warnings
    };
  }

  // 评估质量
  private assessQuality(
    response: string,
    userInput: string,
    shouldProgress: boolean
  ): number {
    let score = 0;
    const maxScore = 4;
    
    // 检查是否包含用户原话关键词
    const userKeywords = this.extractKeywords(userInput);
    const hasUserKeywords = userKeywords.some(keyword => response.includes(keyword));
    if (hasUserKeywords) score++;
    this.qualityMetrics.hasUserKeywords = hasUserKeywords;
    
    // 检查是否有具体情境
    const hasSpecificContext = response.length > 50 && !response.startsWith('我理解');
    if (hasSpecificContext) score++;
    this.qualityMetrics.hasSpecificContext = hasSpecificContext;
    
    // 检查是否避免空洞开头
    const emptyOpenings = ['我理解', '我明白', '我懂', '我明白你的感受'];
    const avoidsEmptyOpening = !emptyOpenings.some(opener => response.startsWith(opener));
    if (avoidsEmptyOpening) score++;
    this.qualityMetrics.avoidsEmptyOpening = avoidsEmptyOpening;
    
    // 检查是否有推进问题（如果应该推进）
    if (shouldProgress) {
      const hasProgressiveQuestion = response.includes('？') || response.includes('?');
      if (hasProgressiveQuestion) score++;
      this.qualityMetrics.hasProgressiveQuestion = hasProgressiveQuestion;
    } else {
      score++; // 如果不应该推进，给满分
      this.qualityMetrics.hasProgressiveQuestion = true;
    }
    
    return score / maxScore;
  }

  // 提取关键词
  private extractKeywords(text: string): string[] {
    // 简单的关键词提取，实际应用中可以使用更复杂的NLP技术
    const words = text.split(/[\s，。！？、；：""''（）【】]+/).filter(w => w.length > 1);
    return [...new Set(words)].slice(0, 5);
  }

  // 获取质量指标
  getQualityMetrics(): typeof this.qualityMetrics {
    return { ...this.qualityMetrics };
  }
}
