/**
 * 塔罗破冰模块 - 数据类型定义
 *
 * 塔罗不是占卜工具，而是投射工具（projective tool）
 * 通过模糊的、开放性的刺激物，让人把内心状态"投射"出来
 */

// ==================== 牌面相关 ====================

/** 牌面 ID（小写英文） */
export type CardId =
  | 'fool' | 'magician' | 'priestess' | 'empress' | 'emperor'
  | 'hierophant' | 'lovers' | 'chariot' | 'strength' | 'hermit'
  | 'wheel' | 'justice' | 'hanged' | 'death' | 'temperance'
  | 'devil' | 'tower' | 'star' | 'moon' | 'sun'
  | 'judgement' | 'world';

/** 面向类型 */
export type AspectType = 'A' | 'B' | 'C' | 'none';

/** 用户对面向的反应 */
export type UserReaction = 'very_much' | 'somewhat' | 'not_really' | 'not_at_all' | 'skip';

/** 牌面情感特征向量 */
export interface CardEmotionProfile {
  valence: number;       // -1.0 到 +1.0
  arousal: number;       // 0.0 到 1.0
  dominance: number;     // 0.0 到 1.0
  associatedEmotions: string[];
  lifeStageHint: string;
}

/** 牌面主题标签 */
export interface CardThemeProfile {
  themes: string[];
  keywords: string[];
}

/** 三面向诠释 */
export interface CardAspects {
  A: string;  // 状态描述
  B: string;  // 内心需求
  C: string;  // 探索方向
}

/** 牌面定义 */
export interface TarotCard {
  id: CardId;
  number: number;           // 0-21
  name: string;             // 中文名
  nameEn: string;           // 英文名
  displayName: string;      // 安全化显示名（敏感牌面使用）
  description: string;      // 牌面描述
  aspects: CardAspects;
  emotionProfile: CardEmotionProfile;
  themeProfile: CardThemeProfile;
  isSensitive: boolean;     // 是否敏感牌面
  sensitiveNote?: string;   // 敏感牌面的安全提示
}

// ==================== 抽牌交互 ====================

/** 抽牌请求 */
export interface DrawRequest {
  userId: string;
  sessionId: string;
  trigger: 'first_hesitation' | 'user_request' | 'exploration_stuck' | 'session_start';
  currentEmotion?: string;
  emotionIntensity?: number;
  knownThemes?: string[];
  knownConflicts?: string[];
}

/** 候选牌（3张） */
export interface CardCandidates {
  cards: [TarotCard, TarotCard, TarotCard];
  selectionReason: {
    emotionCard: CardId;
    themeCard: CardId;
    randomCard: CardId;
  };
}

/** 翻牌结果 */
export interface FlipResult {
  card: TarotCard;
  selectedAspect: AspectType;
  aspectText: string;
  userReaction: UserReaction;
  followUpExpression?: string;
  safetyCheck: SafetyCheckResult;
}

/** 安全检查结果 */
export interface SafetyCheckResult {
  isSafe: boolean;
  action: 'continue' | 'empathy_first' | 'safety_protocol' | 'gentle_redirect';
  instruction: string;
  empathyLevel?: string;
  riskLevel?: 'low' | 'medium' | 'high';
}

// ==================== 塔罗交互记录 ====================

/** 单次塔罗交互记录 */
export interface TarotInteraction {
  drawId: string;
  sessionId: string;
  card: CardId;
  cardChinese: string;
  selectedAspect: AspectType;
  aspectText: string;
  userReaction: UserReaction;
  followUpExpression?: string;
  metaphorTags: string[];
  linkedTheme?: string;
  transitionTo: TransitionTarget;
  timestamp: string;
  safetyFlags?: string[];
}

/** 转入目标 */
export type TransitionTarget =
  | 'emotion_exploration'    // 情绪探索
  | 'value_exploration'      // 价值探索
  | 'constraint_exploration' // 约束探索
  | 'direct_dialogue'        // 直接对话
  | 'safety_protocol'        // 安全协议
  | 'exit';                  // 退出

/** 用户的塔罗档案 */
export interface TarotProfile {
  userId: string;
  totalDraws: number;
  preferredEntry: 'tarot' | 'image' | 'scenario' | 'keyword' | 'direct';
  interactions: TarotInteraction[];
  patterns: TarotPatterns;
  narrativeArc?: NarrativeArc;
}

/** 塔罗模式分析 */
export interface TarotPatterns {
  resonancePattern: string;
  implication: string;
  preferredMetaphors: string[];
  avoidedMetaphors: string[];
  favoriteCards: CardId[];
  avoidedCards: CardId[];
}

// ==================== 叙事线索 ====================

/** 叙事弧线 */
export interface NarrativeArc {
  arc: NarrativePoint[];
  trend: 'improving' | 'declining' | 'fluctuating' | 'unclear';
  narrativeText: string;
  detectedAt: string;
}

/** 叙事点 */
export interface NarrativePoint {
  card: string;
  cardChinese: string;
  valence: number;
  arousal: number;
  userReaction: UserReaction;
  timestamp: string;
  sessionId: string;
}

// ==================== 替代入口 ====================

/** 入口类型 */
export type EntryType = 'tarot' | 'image' | 'scenario' | 'keyword' | 'direct';

/** 替代入口选项 */
export interface AlternativeEntry {
  type: EntryType;
  title: string;
  description: string;
  items: AlternativeItem[];
}

/** 替代入口选项项 */
export interface AlternativeItem {
  id: string;
  text: string;
  imageUrl?: string;
  emotionHint?: string;
  themeHint?: string;
}

/** 入口推荐结果 */
export interface EntryRecommendation {
  recommended: EntryType;
  alternatives: EntryType[];
  reason: string;
  greeting: string;
}

// ==================== 模块配置 ====================

/** 塔罗模块配置 */
export interface TarotModuleConfig {
  /** 每会话最大抽牌次数 */
  maxDrawsPerSession: number;
  /** 是否启用智能选牌 */
  enableSmartSelection: boolean;
  /** 是否启用安全检查 */
  enableSafetyCheck: boolean;
  /** 是否启用叙事检测 */
  enableNarrativeDetection: boolean;
  /** 敏感牌面安全化处理 */
  enableSensitiveCardSoftening: boolean;
  /** 替代入口启用类型 */
  enabledAlternatives: EntryType[];
}

/** 默认配置 */
export const DEFAULT_TAROT_CONFIG: TarotModuleConfig = {
  maxDrawsPerSession: 1,
  enableSmartSelection: true,
  enableSafetyCheck: true,
  enableNarrativeDetection: true,
  enableSensitiveCardSoftening: true,
  enabledAlternatives: ['image', 'scenario', 'keyword', 'direct'],
};
