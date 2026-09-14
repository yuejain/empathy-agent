/**
 * 情感标签体系 - 三层架构
 * 第一层：基础情绪层（10类）
 * 第二层：细粒度情绪层（27类）
 * 第三层：情境化情绪标签
 */

// 情绪类型定义
export interface Emotion {
  id: string;
  name: string;
  layer: 1 | 2 | 3;
  category: 'positive' | 'negative' | 'ambiguous' | 'complex';
  valence: number;      // 效价: -1.0 到 +1.0
  arousal: number;      // 唤醒度: 0.0 到 1.0
  dominance: number;    // 支配度: 0.0 到 1.0
  synonyms: string[];
  description: string;
  empathyStrategy?: string;
}

// 情境化情绪标签
export interface ContextualEmotion {
  baseEmotion: string;
  context: string;
  strategy: string;
  examplePhrases: string[];
}

// 第一层：基础情绪层（10类）
export const LAYER1_EMOTIONS: Emotion[] = [
  // Ekman 6类
  {
    id: 'anxiety',
    name: '焦虑',
    layer: 1,
    category: 'negative',
    valence: -0.7,
    arousal: 0.8,
    dominance: 0.3,
    synonyms: ['担心', '紧张', '不安', '忧虑'],
    description: '对不确定性的担忧和紧张感'
  },
  {
    id: 'sadness',
    name: '悲伤',
    layer: 1,
    category: 'negative',
    valence: -0.8,
    arousal: 0.3,
    dominance: 0.2,
    synonyms: ['难过', '伤心', '悲痛', '哀伤'],
    description: '因失去或失望而产生的痛苦情感'
  },
  {
    id: 'anger',
    name: '愤怒',
    layer: 1,
    category: 'negative',
    valence: -0.9,
    arousal: 0.9,
    dominance: 0.7,
    synonyms: ['生气', '恼火', '暴怒', '愤慨'],
    description: '因不公或阻碍而产生的强烈不满'
  },
  {
    id: 'fear',
    name: '恐惧',
    layer: 1,
    category: 'negative',
    valence: -0.9,
    arousal: 0.9,
    dominance: 0.1,
    synonyms: ['害怕', '恐惧', '惊恐', '畏惧'],
    description: '面对危险或威胁时的害怕感'
  },
  {
    id: 'disgust',
    name: '厌恶',
    layer: 1,
    category: 'negative',
    valence: -0.8,
    arousal: 0.6,
    dominance: 0.5,
    synonyms: ['反感', '厌恶', '恶心', '嫌弃'],
    description: '对某事物的强烈反感和排斥'
  },
  {
    id: 'surprise',
    name: '惊讶',
    layer: 1,
    category: 'ambiguous',
    valence: 0.0,
    arousal: 0.8,
    dominance: 0.5,
    synonyms: ['惊讶', '吃惊', '意外', '震惊'],
    description: '对意外事件的惊讶反应'
  },
  // 扩展4类
  {
    id: 'helplessness',
    name: '无力',
    layer: 1,
    category: 'negative',
    valence: -0.7,
    arousal: 0.4,
    dominance: 0.1,
    synonyms: ['无力', '无助', '无能为力', '束手无策'],
    description: '感到无法控制或改变现状'
  },
  {
    id: 'numbness',
    name: '麻木',
    layer: 1,
    category: 'ambiguous',
    valence: -0.3,
    arousal: 0.2,
    dominance: 0.3,
    synonyms: ['麻木', '冷漠', '无感', '空白'],
    description: '情感上的麻木和缺乏感受'
  },
  {
    id: 'shame',
    name: '羞耻',
    layer: 1,
    category: 'negative',
    valence: -0.8,
    arousal: 0.7,
    dominance: 0.2,
    synonyms: ['羞耻', '羞愧', '惭愧', '尴尬'],
    description: '因自我评价过低而产生的羞耻感'
  },
  {
    id: 'anticipation',
    name: '期待',
    layer: 1,
    category: 'positive',
    valence: 0.6,
    arousal: 0.7,
    dominance: 0.6,
    synonyms: ['期待', '盼望', '希望', '憧憬'],
    description: '对未来美好事物的期待和向往'
  }
];

// 第二层：细粒度情绪层（27类）
export const LAYER2_EMOTIONS: Emotion[] = [
  // 正向9类
  {
    id: 'admiration',
    name: '欣赏/钦佩',
    layer: 2,
    category: 'positive',
    valence: 0.8,
    arousal: 0.6,
    dominance: 0.7,
    synonyms: ['欣赏', '钦佩', '崇拜', '敬佩'],
    description: '对他人优点或成就的钦佩'
  },
  {
    id: 'curiosity',
    name: '兴趣/好奇',
    layer: 2,
    category: 'positive',
    valence: 0.6,
    arousal: 0.7,
    dominance: 0.6,
    synonyms: ['好奇', '感兴趣', '探索欲', '求知欲'],
    description: '对未知事物的探索欲望'
  },
  {
    id: 'anticipation_positive',
    name: '期待',
    layer: 2,
    category: 'positive',
    valence: 0.7,
    arousal: 0.7,
    dominance: 0.6,
    synonyms: ['期待', '盼望', '憧憬', '向往'],
    description: '对未来美好事物的期待'
  },
  {
    id: 'gratitude',
    name: '感恩',
    layer: 2,
    category: 'positive',
    valence: 0.9,
    arousal: 0.5,
    dominance: 0.6,
    synonyms: ['感恩', '感激', '感谢', '谢意'],
    description: '对他人帮助或善意的感激之情'
  },
  {
    id: 'joy',
    name: '喜悦',
    layer: 2,
    category: 'positive',
    valence: 0.9,
    arousal: 0.8,
    dominance: 0.7,
    synonyms: ['喜悦', '快乐', '高兴', '开心'],
    description: '因好事发生而产生的愉悦感'
  },
  {
    id: 'pride',
    name: '自豪',
    layer: 2,
    category: 'positive',
    valence: 0.8,
    arousal: 0.7,
    dominance: 0.8,
    synonyms: ['自豪', '骄傲', '得意', '成就感'],
    description: '因自我成就而产生的自豪感'
  },
  {
    id: 'relief',
    name: '释然',
    layer: 2,
    category: 'positive',
    valence: 0.7,
    arousal: 0.4,
    dominance: 0.6,
    synonyms: ['释然', '放松', '解脱', '如释重负'],
    description: '压力解除后的轻松感'
  },
  {
    id: 'hope',
    name: '希望',
    layer: 2,
    category: 'positive',
    valence: 0.8,
    arousal: 0.6,
    dominance: 0.7,
    synonyms: ['希望', '期盼', '乐观', '信心'],
    description: '对未来的积极期待和信心'
  },
  {
    id: 'loved',
    name: '被爱/被关心',
    layer: 2,
    category: 'positive',
    valence: 0.9,
    arousal: 0.6,
    dominance: 0.7,
    synonyms: ['被爱', '被关心', '温暖', '被重视'],
    description: '感受到他人的爱和关心'
  },
  // 负向12类
  {
    id: 'anxiety_detailed',
    name: '焦虑',
    layer: 2,
    category: 'negative',
    valence: -0.7,
    arousal: 0.8,
    dominance: 0.3,
    synonyms: ['焦虑', '担忧', '紧张', '不安'],
    description: '对不确定性的持续担忧'
  },
  {
    id: 'confusion',
    name: '困惑',
    layer: 2,
    category: 'negative',
    valence: -0.4,
    arousal: 0.5,
    dominance: 0.3,
    synonyms: ['困惑', '迷茫', '不解', '疑惑'],
    description: '对情况或选择感到困惑'
  },
  {
    id: 'disappointment',
    name: '失望',
    layer: 2,
    category: 'negative',
    valence: -0.7,
    arousal: 0.4,
    dominance: 0.3,
    synonyms: ['失望', '沮丧', '灰心', '挫败'],
    description: '期望落空时的失望感'
  },
  {
    id: 'frustration',
    name: '沮丧',
    layer: 2,
    category: 'negative',
    valence: -0.6,
    arousal: 0.6,
    dominance: 0.3,
    synonyms: ['沮丧', '挫败', '受挫', '无奈'],
    description: '目标受阻时的沮丧感'
  },
  {
    id: 'fear_detailed',
    name: '恐惧',
    layer: 2,
    category: 'negative',
    valence: -0.9,
    arousal: 0.9,
    dominance: 0.1,
    synonyms: ['恐惧', '害怕', '惊恐', '畏惧'],
    description: '面对威胁时的害怕感'
  },
  {
    id: 'sadness_detailed',
    name: '悲伤',
    layer: 2,
    category: 'negative',
    valence: -0.8,
    arousal: 0.3,
    dominance: 0.2,
    synonyms: ['悲伤', '难过', '伤心', '悲痛'],
    description: '因失去或失望而痛苦'
  },
  {
    id: 'anger_detailed',
    name: '愤怒',
    layer: 2,
    category: 'negative',
    valence: -0.9,
    arousal: 0.9,
    dominance: 0.7,
    synonyms: ['愤怒', '生气', '恼火', '暴怒'],
    description: '因不公或阻碍而愤怒'
  },
  {
    id: 'shame_detailed',
    name: '羞耻',
    layer: 2,
    category: 'negative',
    valence: -0.8,
    arousal: 0.7,
    dominance: 0.2,
    synonyms: ['羞耻', '羞愧', '惭愧', '尴尬'],
    description: '因自我评价过低而羞耻'
  },
  {
    id: 'jealousy',
    name: '嫉妒',
    layer: 2,
    category: 'negative',
    valence: -0.7,
    arousal: 0.7,
    dominance: 0.4,
    synonyms: ['嫉妒', '眼红', '羡慕', '攀比'],
    description: '对他人拥有的东西感到嫉妒'
  },
  {
    id: 'defeat',
    name: '挫败',
    layer: 2,
    category: 'negative',
    valence: -0.7,
    arousal: 0.5,
    dominance: 0.2,
    synonyms: ['挫败', '失败感', '无力', '沮丧'],
    description: '经历失败后的挫败感'
  },
  {
    id: 'guilt',
    name: '内疚',
    layer: 2,
    category: 'negative',
    valence: -0.7,
    arousal: 0.6,
    dominance: 0.3,
    synonyms: ['内疚', '愧疚', '自责', '后悔'],
    description: '因做错事而产生的内疚感'
  },
  {
    id: 'loneliness',
    name: '孤独',
    layer: 2,
    category: 'negative',
    valence: -0.6,
    arousal: 0.4,
    dominance: 0.2,
    synonyms: ['孤独', '寂寞', '孤立', '被遗忘'],
    description: '感到孤独和缺乏连接'
  },
  // 模糊/复合6类
  {
    id: 'numbness_detailed',
    name: '麻木',
    layer: 2,
    category: 'ambiguous',
    valence: -0.3,
    arousal: 0.2,
    dominance: 0.3,
    synonyms: ['麻木', '冷漠', '无感', '空白'],
    description: '情感上的麻木和缺乏感受'
  },
  {
    id: 'ambivalence',
    name: '矛盾',
    layer: 2,
    category: 'complex',
    valence: -0.2,
    arousal: 0.6,
    dominance: 0.4,
    synonyms: ['矛盾', '纠结', '挣扎', '两难'],
    description: '同时存在相反的情感或想法'
  },
  {
    id: 'fear_and_desire',
    name: '既期待又怕',
    layer: 2,
    category: 'complex',
    valence: 0.0,
    arousal: 0.7,
    dominance: 0.4,
    synonyms: ['既期待又怕', '又爱又怕', '矛盾心理'],
    description: '同时期待和害怕某事发生'
  },
  {
    id: 'helplessness_detailed',
    name: '无力感',
    layer: 2,
    category: 'negative',
    valence: -0.7,
    arousal: 0.4,
    dominance: 0.1,
    synonyms: ['无力感', '无助', '无能为力', '束手无策'],
    description: '感到无法控制或改变现状'
  },
  {
    id: 'cognitive_dissonance',
    name: '认知失调',
    layer: 2,
    category: 'complex',
    valence: -0.4,
    arousal: 0.6,
    dominance: 0.3,
    synonyms: ['认知失调', '矛盾', '不一致', '冲突'],
    description: '信念与行为不一致时的心理不适'
  },
  {
    id: 'nostalgia',
    name: '怀旧/遗憾',
    layer: 2,
    category: 'complex',
    valence: -0.2,
    arousal: 0.4,
    dominance: 0.4,
    synonyms: ['怀旧', '遗憾', '怀念', '追忆'],
    description: '对过去的怀念和遗憾'
  }
];

// 第三层：情境化情绪标签示例
export const LAYER3_CONTEXTUAL_EMOTIONS: ContextualEmotion[] = [
  {
    baseEmotion: 'anxiety',
    context: '认知性焦虑',
    strategy: '帮助用户识别和挑战灾难化思维，提供认知重构技巧',
    examplePhrases: [
      '我担心如果我不做这个，就会发生很糟糕的事情',
      '我总是想最坏的情况',
      '我觉得自己会失败'
    ]
  },
  {
    baseEmotion: 'anxiety',
    context: '存在性焦虑',
    strategy: '承认这种焦虑的普遍性，引导探索价值观和意义',
    examplePhrases: [
      '我不知道人生的意义是什么',
      '我觉得一切都无所谓',
      '我找不到活着的意义'
    ]
  },
  {
    baseEmotion: 'anxiety',
    context: '社会性焦虑',
    strategy: '帮助用户识别社交情境中的具体担忧，提供社交技巧',
    examplePhrases: [
      '我害怕在人群中说话',
      '我担心别人会怎么想我',
      '我总是觉得别人在评判我'
    ]
  },
  {
    baseEmotion: 'sadness',
    context: '丧失性悲伤',
    strategy: '允许充分哀悼，提供哀伤辅导，避免过早建议',
    examplePhrases: [
      '我失去了重要的人',
      '我的宠物去世了',
      '我失去了工作'
    ]
  },
  {
    baseEmotion: 'sadness',
    context: '存在性悲伤',
    strategy: '承认这种感受的深度，引导探索意义和价值',
    examplePhrases: [
      '我觉得人生没有意义',
      '我不知道为什么要继续',
      '一切都感觉空虚'
    ]
  },
  {
    baseEmotion: 'anger',
    context: '正义性愤怒',
    strategy: '承认愤怒的合理性，帮助用户以建设性方式表达',
    examplePhrases: [
      '这不公平！',
      '他们怎么可以这样对我',
      '我被欺骗了'
    ]
  },
  {
    baseEmotion: 'anger',
    context: '防御性愤怒',
    strategy: '帮助用户识别愤怒背后的脆弱感，提供安全表达空间',
    examplePhrases: [
      '我不想让他们看到我受伤',
      '愤怒比脆弱更容易',
      '我必须保护自己'
    ]
  }
];

// 获取所有情绪标签
export function getAllEmotions(): Emotion[] {
  return [...LAYER1_EMOTIONS, ...LAYER2_EMOTIONS];
}

// 根据ID获取情绪
export function getEmotionById(id: string): Emotion | undefined {
  return getAllEmotions().find(e => e.id === id);
}

// 根据名称搜索情绪
export function searchEmotions(query: string): Emotion[] {
  const lowerQuery = query.toLowerCase();
  return getAllEmotions().filter(e => 
    e.name.toLowerCase().includes(lowerQuery) ||
    e.synonyms.some(s => s.toLowerCase().includes(lowerQuery))
  );
}

// 获取情境化情绪策略
export function getContextualStrategy(emotionId: string, context: string): string | undefined {
  const contextual = LAYER3_CONTEXTUAL_EMOTIONS.find(
    ce => ce.baseEmotion === emotionId && ce.context === context
  );
  return contextual?.strategy;
}