/**
 * 塔罗破冰模块 - 22张大阿尔卡纳牌面数据
 *
 * 每张牌包含：
 * - 三面向诠释（状态描述/内心需求/探索方向）
 * - 情感特征向量（效价/唤醒度/支配度）
 * - 主题标签
 * - 敏感牌面安全化处理
 */

import { TarotCard, CardId, CardEmotionProfile, CardThemeProfile } from './types';

// ==================== 22张大阿尔卡纳 ====================

export const MAJOR_ARCANA: TarotCard[] = [
  // ========== 0 愚者 ==========
  {
    id: 'fool',
    number: 0,
    name: '愚者',
    nameEn: 'The Fool',
    displayName: '愚者',
    description: '牌面上是一个人站在悬崖边，面朝天空，手里拿着一朵花，看起来毫不担心脚下的深渊。',
    aspects: {
      A: '你正站在一个起点，前方什么都看不清。',
      B: '你内心渴望一种无畏的自由，不用想太多。',
      C: '如果不怕犯错，你最想尝试什么？',
    },
    emotionProfile: {
      valence: 0.3,
      arousal: 0.6,
      dominance: 0.4,
      associatedEmotions: ['curiosity', 'anticipation', 'anxiety'],
      lifeStageHint: 'beginning',
    },
    themeProfile: {
      themes: ['new_beginning', 'risk_taking', 'fear_of_unknown'],
      keywords: ['开始', '未知', '勇气', '自由', '尝试'],
    },
    isSensitive: false,
  },

  // ========== I 魔术师 ==========
  {
    id: 'magician',
    number: 1,
    name: '魔术师',
    nameEn: 'The Magician',
    displayName: '魔术师',
    description: '牌面上是一个人，面前摆着各种工具，一只手举向天空，另一只手指向大地。',
    aspects: {
      A: '你觉得自己手里有资源，但不知道怎么组合。',
      B: '你渴望一种"我能搞定"的掌控感。',
      C: '你上一次感到"我做到了"是什么时候？',
    },
    emotionProfile: {
      valence: 0.4,
      arousal: 0.6,
      dominance: 0.7,
      associatedEmotions: ['pride', 'confidence', 'frustration'],
      lifeStageHint: 'empowerment',
    },
    themeProfile: {
      themes: ['self_efficacy', 'resourcefulness', 'imposter_syndrome'],
      keywords: ['能力', '掌控', '资源', '自信', '怀疑'],
    },
    isSensitive: false,
  },

  // ========== II 女祭司 ==========
  {
    id: 'priestess',
    number: 2,
    name: '女祭司',
    nameEn: 'The High Priestess',
    displayName: '女祭司',
    description: '牌面上是一个安静的女性形象，坐在两根柱子之间，手中抱着一卷书。',
    aspects: {
      A: '你直觉里有些东西，但还没说出来。',
      B: '你需要一个安静的空间去倾听自己。',
      C: '你最近一次感到平静是什么时候？',
    },
    emotionProfile: {
      valence: 0.1,
      arousal: 0.3,
      dominance: 0.5,
      associatedEmotions: ['calm', 'intuition', 'repression'],
      lifeStageHint: 'introspection',
    },
    themeProfile: {
      themes: ['intuition', 'inner_knowing', 'repression'],
      keywords: ['直觉', '安静', '倾听', '内心', '隐藏'],
    },
    isSensitive: false,
  },

  // ========== III 女皇 ==========
  {
    id: 'empress',
    number: 3,
    name: '女皇',
    nameEn: 'The Empress',
    displayName: '女皇',
    description: '牌面上是一个坐在花园中的女性形象，周围环绕着自然和丰收的景象。',
    aspects: {
      A: '你想要更多滋养、更舒适的状态。',
      B: '你渴望被照顾，或者照顾自己。',
      C: '你最近一次好好对待自己是什么时候？',
    },
    emotionProfile: {
      valence: 0.5,
      arousal: 0.4,
      dominance: 0.5,
      associatedEmotions: ['caring', 'comfort', 'longing'],
      lifeStageHint: 'nurturing',
    },
    themeProfile: {
      themes: ['self_care', 'creativity', 'nurturing'],
      keywords: ['滋养', '舒适', '照顾', '创造力', '丰盛'],
    },
    isSensitive: false,
  },

  // ========== IV 皇帝 ==========
  {
    id: 'emperor',
    number: 4,
    name: '皇帝',
    nameEn: 'The Emperor',
    displayName: '皇帝',
    description: '牌面上是一个坐在石头宝座上的严肃形象，手中拿着权杖和宝球。',
    aspects: {
      A: '你觉得生活中缺少结构和秩序。',
      B: '你渴望一种稳定的支撑。',
      C: '如果有一个完全稳定的支点，会是什么？',
    },
    emotionProfile: {
      valence: 0.0,
      arousal: 0.4,
      dominance: 0.7,
      associatedEmotions: ['stability', 'control', 'frustration'],
      lifeStageHint: 'structure',
    },
    themeProfile: {
      themes: ['structure', 'control', 'authority_issues'],
      keywords: ['稳定', '秩序', '规则', '权威', '控制'],
    },
    isSensitive: false,
  },

  // ========== V 教皇 ==========
  {
    id: 'hierophant',
    number: 5,
    name: '教皇',
    nameEn: 'The Hierophant',
    displayName: '教皇',
    description: '牌面上是一个坐在两根柱子间的长者形象，面前有两个跪着的人。',
    aspects: {
      A: '你正在寻找某种可以相信的东西。',
      B: '你渴望一个引路人或一套信念。',
      C: '你曾经最信服的一个人或一个道理是什么？',
    },
    emotionProfile: {
      valence: 0.1,
      arousal: 0.3,
      dominance: 0.4,
      associatedEmotions: ['seeking', 'confusion', 'longing'],
      lifeStageHint: 'seeking_guidance',
    },
    themeProfile: {
      themes: ['belief', 'tradition', 'conformity_pressure'],
      keywords: ['信念', '引导', '传统', '规则', '归属'],
    },
    isSensitive: false,
  },

  // ========== VI 恋人 ==========
  {
    id: 'lovers',
    number: 6,
    name: '恋人',
    nameEn: 'The Lovers',
    displayName: '恋人',
    description: '牌面上是两个人站在天使下方，面前有两棵树——一棵是苹果树，一棵是火焰树。',
    aspects: {
      A: '你面前有两条路，都很吸引你。',
      B: '你渴望一个不需要纠结的选择。',
      C: '如果只听内心那个更安静的声音，它在说什么？',
    },
    emotionProfile: {
      valence: 0.2,
      arousal: 0.6,
      dominance: 0.3,
      associatedEmotions: ['ambivalence', 'desire', 'confusion'],
      lifeStageHint: 'choice',
    },
    themeProfile: {
      themes: ['choice', 'values_conflict', 'relationship'],
      keywords: ['选择', '纠结', '价值观', '冲突', '渴望'],
    },
    isSensitive: false,
  },

  // ========== VII 战车 ==========
  {
    id: 'chariot',
    number: 7,
    name: '战车',
    nameEn: 'The Chariot',
    displayName: '战车',
    description: '牌面上是一个人驾驶着一辆战车，被两只朝不同方向拉的狮身人面兽拉着。',
    aspects: {
      A: '你觉得应该前进，但动力不足。',
      B: '你渴望一种势不可挡的冲劲。',
      C: '是什么在拉着你不让你动？',
    },
    emotionProfile: {
      valence: -0.1,
      arousal: 0.6,
      dominance: 0.5,
      associatedEmotions: ['frustration', 'motivation', 'inner_conflict'],
      lifeStageHint: 'stuck',
    },
    themeProfile: {
      themes: ['willpower', 'direction', 'inner_conflict'],
      keywords: ['前进', '动力', '冲突', '拉扯', '意志'],
    },
    isSensitive: false,
  },

  // ========== VIII 力量 ==========
  {
    id: 'strength',
    number: 8,
    name: '力量',
    nameEn: 'Strength',
    displayName: '力量',
    description: '牌面上是一个人温柔地抚摸着一头狮子，两者之间有一种平静的和谐。',
    aspects: {
      A: '你在用意志力对抗某种恐惧或冲动。',
      B: '你渴望温柔地接纳自己的脆弱。',
      C: '你最不敢面对的那个"万一"是什么？',
    },
    emotionProfile: {
      valence: 0.2,
      arousal: 0.5,
      dominance: 0.6,
      associatedEmotions: ['courage', 'vulnerability', 'self_acceptance'],
      lifeStageHint: 'confrontation',
    },
    themeProfile: {
      themes: ['courage', 'vulnerability', 'self_acceptance'],
      keywords: ['勇气', '脆弱', '接纳', '恐惧', '温柔'],
    },
    isSensitive: false,
  },

  // ========== IX 隐士 ==========
  {
    id: 'hermit',
    number: 9,
    name: '隐士',
    nameEn: 'The Hermit',
    displayName: '隐士',
    description: '牌面上是一个人站在山顶，手持一盏灯笼，独自眺望远方。',
    aspects: {
      A: '你想要一个人待着，想清楚一些事。',
      B: '你渴望一个不被打扰的空间。',
      C: '你有多久没有真正一个人安静过了？',
    },
    emotionProfile: {
      valence: -0.1,
      arousal: 0.2,
      dominance: 0.5,
      associatedEmotions: ['loneliness', 'reflection', 'numbness'],
      lifeStageHint: 'introspection',
    },
    themeProfile: {
      themes: ['solitude', 'introspection', 'withdrawal'],
      keywords: ['独处', '安静', '思考', '空间', '灯笼'],
    },
    isSensitive: false,
  },

  // ========== X 命运之轮 ==========
  {
    id: 'wheel',
    number: 10,
    name: '命运之轮',
    nameEn: 'Wheel of Fortune',
    displayName: '命运之轮',
    description: '牌面上是一个巨大的轮子在转动，轮子上有各种符号，周围有云和风。',
    aspects: {
      A: '你觉得生活好像在转，你控制不了。',
      B: '你渴望在变化中找到一个锚点。',
      C: '你最近经历的一个意外变化是什么？',
    },
    emotionProfile: {
      valence: -0.2,
      arousal: 0.6,
      dominance: 0.2,
      associatedEmotions: ['helplessness', 'anxiety', 'acceptance'],
      lifeStageHint: 'change',
    },
    themeProfile: {
      themes: ['change', 'acceptance', 'loss_of_control'],
      keywords: ['变化', '控制', '命运', '意外', '接受'],
    },
    isSensitive: false,
  },

  // ========== XI 正义 ==========
  {
    id: 'justice',
    number: 11,
    name: '正义',
    nameEn: 'Justice',
    displayName: '正义',
    description: '牌面上是一个手持天平和剑的形象，端坐在两根柱子之间。',
    aspects: {
      A: '你在衡量某种公平——对自己、对他人。',
      B: '你渴望一种"被公正对待"的感觉。',
      C: '你最近一次觉得"这不公平"是什么事？',
    },
    emotionProfile: {
      valence: -0.2,
      arousal: 0.5,
      dominance: 0.5,
      associatedEmotions: ['anger', 'fairness', 'guilt'],
      lifeStageHint: 'evaluation',
    },
    themeProfile: {
      themes: ['fairness', 'accountability', 'guilt'],
      keywords: ['公平', '衡量', '责任', '对错', '评判'],
    },
    isSensitive: false,
  },

  // ========== XII 倒吊人 ==========
  {
    id: 'hanged',
    number: 12,
    name: '倒吊人',
    nameEn: 'The Hanged Man',
    displayName: '倒吊人',
    description: '牌面上是一个人倒挂着，但表情平静，头周围有一圈光晕。',
    aspects: {
      A: '你觉得卡住了，但可能在换一个角度看。',
      B: '你渴望从困境中找到新的视角。',
      C: '如果从完全不同的角度看你的困境，会看到什么？',
    },
    emotionProfile: {
      valence: -0.2,
      arousal: 0.3,
      dominance: 0.3,
      associatedEmotions: ['stuck', 'patience', 'new_perspective'],
      lifeStageHint: 'suspension',
    },
    themeProfile: {
      themes: ['suspension', 'new_perspective', 'stuck'],
      keywords: ['卡住', '等待', '新角度', '暂停', '放下'],
    },
    isSensitive: false,
  },

  // ========== XIII 死神（敏感牌面） ==========
  {
    id: 'death',
    number: 13,
    name: '死神',
    nameEn: 'Death',
    displayName: '转变',  // 安全化显示名
    description: '牌面上是一个骑着白马的形象，面前有倒下的人和站着的人。远处有太阳正在升起。',
    aspects: {
      A: '某个阶段正在结束，你感到不安。',
      B: '你渴望对"失去"这件事的接纳。',
      C: '如果有一件事正在自然地走向结束，你觉得会是什么？',
    },
    emotionProfile: {
      valence: -0.5,
      arousal: 0.7,
      dominance: 0.2,
      associatedEmotions: ['grief', 'fear', 'transformation'],
      lifeStageHint: 'ending',
    },
    themeProfile: {
      themes: ['ending', 'transformation', 'grief'],
      keywords: ['结束', '失去', '转变', '告别', '新生'],
    },
    isSensitive: true,
    sensitiveNote: '这张牌象征"转变"而非字面意义。牌面远处有日出，代表新的开始。',
  },

  // ========== XIV 节制 ==========
  {
    id: 'temperance',
    number: 14,
    name: '节制',
    nameEn: 'Temperance',
    displayName: '节制',
    description: '牌面上是一个天使，一只脚在水中，一只脚在陆地上，手中的两个杯子之间有水流循环。',
    aspects: {
      A: '你在尝试平衡生活中的不同部分。',
      B: '你渴望一种不多不少的刚刚好。',
      C: '你生活中哪个部分最失衡？',
    },
    emotionProfile: {
      valence: 0.2,
      arousal: 0.3,
      dominance: 0.5,
      associatedEmotions: ['balance', 'patience', 'excess'],
      lifeStageHint: 'integration',
    },
    themeProfile: {
      themes: ['balance', 'patience', 'excess'],
      keywords: ['平衡', '节制', '刚刚好', '失衡', '调和'],
    },
    isSensitive: false,
  },

  // ========== XV 恶魔（敏感牌面） ==========
  {
    id: 'devil',
    number: 15,
    name: '恶魔',
    nameEn: 'The Devil',
    displayName: '束缚',  // 安全化显示名
    description: '牌面上是一个巨大的形象，脚下锁着两个人。但仔细看，锁链是松的——他们随时可以离开。',
    aspects: {
      A: '你觉得被某种东西绑住了——习惯、关系、执念。',
      B: '你渴望挣脱，但又害怕失去。',
      C: '如果放手，你最怕失去什么？',
    },
    emotionProfile: {
      valence: -0.5,
      arousal: 0.7,
      dominance: 0.3,
      associatedEmotions: ['attachment', 'addiction', 'shadow_self'],
      lifeStageHint: 'bondage',
    },
    themeProfile: {
      themes: ['attachment', 'addiction', 'shadow_self'],
      keywords: ['束缚', '依赖', '习惯', '执念', '挣脱'],
    },
    isSensitive: true,
    sensitiveNote: '这张牌象征"束缚"，但牌面中锁链是松的——暗示自由一直在你手中。',
  },

  // ========== XVI 高塔（敏感牌面） ==========
  {
    id: 'tower',
    number: 16,
    name: '高塔',
    nameEn: 'The Tower',
    displayName: '重建',  // 安全化显示名
    description: '牌面上是一座被闪电击中的塔，有人从塔上落下。但天空中有火花，暗示新的可能。',
    aspects: {
      A: '你生活中可能正在经历一些大的变动。',
      B: '你渴望在变动中找到新的地基。',
      C: '你最近一次信念被动摇是什么事？',
    },
    emotionProfile: {
      valence: -0.7,
      arousal: 0.9,
      dominance: 0.1,
      associatedEmotions: ['shock', 'anger', 'fear', 'revelation'],
      lifeStageHint: 'disruption',
    },
    themeProfile: {
      themes: ['disruption', 'revelation', 'catastrophizing'],
      keywords: ['变动', '崩塌', '重建', '冲击', '觉醒'],
    },
    isSensitive: true,
    sensitiveNote: '这张牌象征"重建"——有时候需要先打破旧的，才能建起新的。',
  },

  // ========== XVII 星星 ==========
  {
    id: 'star',
    number: 17,
    name: '星星',
    nameEn: 'The Star',
    displayName: '星星',
    description: '牌面上是一个人在星空下，一手倒水入池，一手倒水入大地。周围有八颗星星。',
    aspects: {
      A: '你在黑暗中看到了一点光。',
      B: '你渴望希望——哪怕只是一点点。',
      C: '最近有没有一个小小的、让你觉得"也许可以"的瞬间？',
    },
    emotionProfile: {
      valence: 0.5,
      arousal: 0.3,
      dominance: 0.4,
      associatedEmotions: ['hope', 'optimism', 'relief', 'vulnerability'],
      lifeStageHint: 'recovery',
    },
    themeProfile: {
      themes: ['hope', 'renewal', 'vulnerability'],
      keywords: ['希望', '光', '可能', '疗愈', '安静'],
    },
    isSensitive: false,
  },

  // ========== XVIII 月亮 ==========
  {
    id: 'moon',
    number: 18,
    name: '月亮',
    nameEn: 'The Moon',
    displayName: '月亮',
    description: '牌面上是一个夜晚的场景——月光照着一条弯曲的路，路的两旁有些看不清楚的东西。',
    aspects: {
      A: '你感到迷茫，看不清楚，有些焦虑。',
      B: '你渴望在不确定中找到安全感。',
      C: '你最不确定的是什么？',
    },
    emotionProfile: {
      valence: -0.4,
      arousal: 0.5,
      dominance: 0.2,
      associatedEmotions: ['anxiety', 'confusion', 'fear', 'uncertainty'],
      lifeStageHint: 'uncertainty',
    },
    themeProfile: {
      themes: ['uncertainty', 'anxiety', 'subconscious'],
      keywords: ['迷茫', '不确定', '焦虑', '看不清', '夜晚'],
    },
    isSensitive: false,
  },

  // ========== XIX 太阳 ==========
  {
    id: 'sun',
    number: 19,
    name: '太阳',
    nameEn: 'The Sun',
    displayName: '太阳',
    description: '牌面上是一个明亮的太阳，下面有一个孩子骑在白马上，周围是向日葵。',
    aspects: {
      A: '你其实有能量，但可能还没释放出来。',
      B: '你渴望一种毫无保留的快乐。',
      C: '你最近一次毫无顾忌地开心是什么时候？',
    },
    emotionProfile: {
      valence: 0.8,
      arousal: 0.7,
      dominance: 0.7,
      associatedEmotions: ['joy', 'vitality', 'authenticity', 'suppressed_joy'],
      lifeStageHint: 'expression',
    },
    themeProfile: {
      themes: ['vitality', 'authenticity', 'suppressed_joy'],
      keywords: ['能量', '快乐', '释放', '真实', '阳光'],
    },
    isSensitive: false,
  },

  // ========== XX 审判 ==========
  {
    id: 'judgement',
    number: 20,
    name: '审判',
    nameEn: 'Judgement',
    displayName: '审判',
    description: '牌面上是一个天使在天空中吹号角，地上的人们从棺材中站起，张开双臂。',
    aspects: {
      A: '你内心有个声音在呼唤你做某个决定。',
      B: '你渴望一种"对了"的确信感。',
      C: '如果不考虑任何后果，你内心已经知道答案了吗？',
    },
    emotionProfile: {
      valence: 0.3,
      arousal: 0.6,
      dominance: 0.5,
      associatedEmotions: ['calling', 'decision', 'self_forgiveness'],
      lifeStageHint: 'awakening',
    },
    themeProfile: {
      themes: ['calling', 'decision', 'self_forgiveness'],
      keywords: ['呼唤', '决定', '确信', '觉醒', '原谅'],
    },
    isSensitive: false,
  },

  // ========== XXI 世界 ==========
  {
    id: 'world',
    number: 21,
    name: '世界',
    nameEn: 'The World',
    displayName: '世界',
    description: '牌面上是一个人在花环中翩翩起舞，手中拿着两根权杖，四角有四个象征。',
    aspects: {
      A: '你其实已经走了很远，只是还没意识到。',
      B: '你渴望一种完成感和归属感。',
      C: '回头看你走过的路，你看到了什么？',
    },
    emotionProfile: {
      valence: 0.6,
      arousal: 0.5,
      dominance: 0.7,
      associatedEmotions: ['completion', 'integration', 'readiness', 'pride'],
      lifeStageHint: 'completion',
    },
    themeProfile: {
      themes: ['completion', 'integration', 'readiness'],
      keywords: ['完成', '旅程', '归属', '成就', '回顾'],
    },
    isSensitive: false,
  },
];

// ==================== 辅助函数 ====================

/** 根据 ID 获取牌面 */
export function getCardById(id: CardId): TarotCard | undefined {
  return MAJOR_ARCANA.find(card => card.id === id);
}

/** 根据编号获取牌面 */
export function getCardByNumber(number: number): TarotCard | undefined {
  return MAJOR_ARCANA.find(card => card.number === number);
}

/** 获取所有敏感牌面 */
export function getSensitiveCards(): TarotCard[] {
  return MAJOR_ARCANA.filter(card => card.isSensitive);
}

/** 获取所有牌面 ID */
export function getAllCardIds(): CardId[] {
  return MAJOR_ARCANA.map(card => card.id);
}

/** 情绪-牌面映射表 */
export const EMOTION_CARD_MAP: Record<string, CardId[]> = {
  '焦虑': ['moon', 'wheel', 'hanged'],
  '困惑': ['moon', 'hanged', 'lovers'],
  '恐惧': ['moon', 'tower', 'death'],
  '悲伤': ['death', 'hermit', 'hanged'],
  '愤怒': ['tower', 'justice', 'chariot'],
  '无力': ['hanged', 'hermit', 'wheel'],
  '麻木': ['hermit', 'death', 'hanged'],
  '羞耻': ['devil', 'judgement', 'justice'],
  '期待': ['fool', 'star', 'sun'],
  '希望': ['star', 'sun', 'world'],
  '好奇': ['fool', 'magician', 'priestess'],
  '喜悦': ['sun', 'world', 'empress'],
  '孤独': ['hermit', 'moon', 'hanged'],
  '挫败': ['chariot', 'tower', 'wheel'],
  '矛盾': ['lovers', 'temperance', 'hanged'],
  '既期待又怕': ['fool', 'lovers', 'star'],
};

/** 主题-牌面映射表 */
export const THEME_CARD_MAP: Record<string, CardId[]> = {
  '自主': ['fool', 'magician', 'emperor'],
  '稳定': ['emperor', 'hierophant', 'temperance'],
  '成长': ['fool', 'star', 'world'],
  '连接': ['lovers', 'empress', 'hierophant'],
  '创造': ['magician', 'empress', 'sun'],
  '意义': ['hermit', 'judgement', 'star'],
  '安全': ['emperor', 'strength', 'star'],
  '自由': ['fool', 'devil', 'star'],
  '怕失败': ['tower', 'chariot', 'strength'],
  '选择困难': ['lovers', 'hanged', 'judgement'],
  '职业迷茫': ['hermit', 'wheel', 'chariot'],
  '关系困惑': ['lovers', 'empress', 'devil'],
  '自我怀疑': ['moon', 'magician', 'strength'],
  '压力过大': ['tower', 'chariot', 'emperor'],
};
