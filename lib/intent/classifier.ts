/**
 * 本地意图规则与安全信号快筛。
 * 上下文意图由编排器的合并分析请求提供，此模块不发起云端调用。
 */

import {
  IntentRecognitionResult, IntentConfig, DEFAULT_INTENT_CONFIG,
  SafetyIntent, InteractionIntent, SubIntent,
} from './types';

// ==================== Level 0: 安全快筛 ====================

/** 安全关键词库 */
const SAFETY_KEYWORDS: Record<SafetyIntent, string[]> = {
  'L1.1_crisis_help': [
    '不想活了', '想死', '活不下去', '自杀', '结束生命',
    '割腕', '跳楼', '不想存在了', '活着没意思',
    '没有人在乎', '解脱', '遗书', '死了算了',
    '生不如死', '不想活', '活够了',
  ],
  'L1.2_self_harm': [
    '自残', '伤害自己', '打自己', '掐自己',
    '割伤自己', '弄伤自己',
  ],
  'L1.3_harm_others': [
    '想打人', '想杀人', '报复', '恨到想弄死',
    '杀了他', '杀了她', '伤害别人',
  ],
};

/** 安全正则模式 */
const SAFETY_PATTERNS: Array<{ pattern: RegExp; intent: SafetyIntent }> = [
  { pattern: /(我|真的)?(不想|没法)(活|存在)了/, intent: 'L1.1_crisis_help' },
  { pattern: /(想|要去)(死|自杀|跳楼|割腕)/, intent: 'L1.1_crisis_help' },
  { pattern: /(活着|存在)(有)?什么(意义|意思)/, intent: 'L1.1_crisis_help' },
  { pattern: /(我|想)(伤害|残害|弄伤)(自己)/, intent: 'L1.2_self_harm' },
  { pattern: /(想|要去)(打|杀|伤害|报复)(他|她|人)/, intent: 'L1.3_harm_others' },
];

/** Level 0: 安全快筛 */
function safetyQuickScreen(input: string): {
  isSafety: boolean;
  intent?: SafetyIntent;
  confidence?: number;
} {
  const inputLower = input.toLowerCase();

  // 关键词匹配
  for (const [intent, keywords] of Object.entries(SAFETY_KEYWORDS)) {
    for (const keyword of keywords) {
      if (inputLower.includes(keyword.toLowerCase())) {
        return {
          isSafety: true,
          intent: intent as SafetyIntent,
          confidence: 0.95,
        };
      }
    }
  }

  // 正则匹配
  for (const { pattern, intent } of SAFETY_PATTERNS) {
    if (pattern.test(input)) {
      return {
        isSafety: true,
        intent,
        confidence: 0.9,
      };
    }
  }

  return { isSafety: false };
}

// ==================== Level 1: 粗分类 ====================

/** 意图关键词映射 */
const INTENT_KEYWORDS: Record<InteractionIntent, string[]> = {
  'L2.1_emotional_venting': [
    '受够了', '烦死了', '好累', '崩溃', '撑不住',
    '受不了', '好烦', '好难过', '好伤心', '好痛苦',
    '无所谓', '随便', '都行', '不知道为什么', '就是觉得',
    'emo了', '破防了', '绷不住了',
  ],
  'L2.2_exploration_request': [
    '我到底想要什么', '我不知道', '帮我理一理', '想不清楚',
    '为什么会这样', '我怎么了', '搞不清楚', '理清',
    '想明白', '搞明白', '帮我分析',
  ],
  'L2.3_action_discussion': [
    '我在考虑', '我想辞职', '我想报', '我想试试',
    '我应该', '要不要', '面试', '投简历', '去不去',
    '做了', '完成了', '试了', '结果',
  ],
  'L2.4_review_request': [
    '回顾', '回头看看', '之前说的', '有没有变化',
    '复盘', '总结', '看看进展',
  ],
  'L2.5_advice_seeking': [
    '你觉得', '给我建议', '我该怎么办', '怎么做',
    '有什么方法', '你建议', '告诉我', '帮我决定',
  ],
  'L2.6_information_query': [
    '你是真人', '你是AI', '你能记住', '数据安全',
    '隐私', '怎么用', '功能', '塔罗牌是怎么',
    '这个产品', '你们怎么帮',
  ],
  'L2.7_meta_conversation': [
    '没用', '不理解我', '别老问', '换个方式',
    '说得对', '挺好的', '直接一点', '别绕弯子',
    '换个话题', '不聊这个了', '先不说',
  ],
  'L2.8_relationship_building': [
    '你能理解我吗', '不会告诉别人', '你会不会觉得我奇怪',
    '你有感受吗', '你真的', '信任',
  ],
  'L2.9_ambiguous_intent': [],
};

/** Level 1: 粗分类 */
function coarseClassify(input: string): {
  intent: InteractionIntent;
  confidence: number;
} {
  const inputLower = input.toLowerCase();

  // 计算每个意图的匹配分数
  const scores: Array<{ intent: InteractionIntent; score: number }> = [];

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (inputLower.includes(keyword.toLowerCase())) {
        score += 1;
      }
    }
    // 归一化
    const confidence = Math.min(score * 0.3, 0.95);
    scores.push({ intent: intent as InteractionIntent, score: confidence });
  }

  // 排序
  scores.sort((a, b) => b.score - a.score);

  if (scores[0].score > 0) {
    return {
      intent: scores[0].intent,
      confidence: scores[0].score,
    };
  }

  // 默认为意图不明
  return {
    intent: 'L2.9_ambiguous_intent',
    confidence: 0.3,
  };
}

// ==================== 意图分类器主类 ====================

export class IntentClassifier {
  private config: IntentConfig;

  constructor(config: Partial<IntentConfig> = {}) {
    this.config = { ...DEFAULT_INTENT_CONFIG, ...config };
  }

  /**
   * 执行完整的三级级联意图识别
   */
  async classify(
    input: string,
    context: {
      recentHistory: string[];
      currentState: string;
      emotion: { primary: string; intensity: number; valence: number };
      userValues?: string[];
      userThemes?: string[];
    }
  ): Promise<IntentRecognitionResult> {
    // ═══ Level 0: 安全快筛 ═══
    if (this.config.enableSafetyScreen) {
      const safetyResult = safetyQuickScreen(input);
      if (safetyResult.isSafety) {
        return {
          isSafetyIntent: true,
          safetyIntent: safetyResult.intent,
          primaryIntent: 'L2.1_emotional_venting', // 占位
          confidence: safetyResult.confidence || 0.95,
          recognitionLevel: 0,
          reasoning: `安全快筛命中：${safetyResult.intent}`,
          contextClues: [],
          safetyAttention: 'high',
        };
      }
    }

    // ═══ Level 1: 粗分类 ═══
    const level1Result = coarseClassify(input);

    // 如果置信度足够高，直接使用
    if (level1Result.confidence >= this.config.level1ConfidenceThreshold &&
        level1Result.intent !== 'L2.9_ambiguous_intent') {
      return {
        isSafetyIntent: false,
        primaryIntent: level1Result.intent,
        confidence: level1Result.confidence,
        recognitionLevel: 1,
        reasoning: `Level 1 关键词匹配`,
        contextClues: [],
        safetyAttention: this.assessSafetyAttention(input),
      };
    }

    // 降级：使用 Level 1 结果
    return {
      isSafetyIntent: false,
      primaryIntent: level1Result.intent,
      confidence: level1Result.confidence,
      recognitionLevel: 1,
      reasoning: '本地分类；上下文分析由编排器合并调用后覆盖',
      contextClues: [],
      safetyAttention: this.assessSafetyAttention(input),
    };
  }

  /**
   * 评估安全关注度
   */
  private assessSafetyAttention(input: string): 'none' | 'low' | 'medium' | 'high' {
    const warningKeywords = ['撑不住', '撑多久', '极限', '到头了', '没意义'];
    const hasWarning = warningKeywords.some(kw => input.includes(kw));

    if (hasWarning) return 'medium';

    const lowWarning = ['累', '烦', '不想', '算了'];
    const hasLowWarning = lowWarning.some(kw => input.includes(kw));
    if (hasLowWarning) return 'low';

    return 'none';
  }
}
