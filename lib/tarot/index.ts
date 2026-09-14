/**
 * 塔罗破冰模块 - 统一导出
 *
 * 模块架构：
 * ┌─────────────────────────────────────────────────────────┐
 * │                  TarotInteractionManager                 │
 * │                 (交互流程管理主类)                         │
 * ├─────────────────────────────────────────────────────────┤
 * │  CardMatcher        │ TarotSafetyChecker │ GreetingGen  │
 * │  (牌面匹配算法)      │ (安全检查器)        │ (话术生成)   │
 * ├─────────────────────────────────────────────────────────┤
 * │  NarrativeDetector  │ MetaphorManager    │ EntrySelector │
 * │  (叙事线索检测)      │ (隐喻线索管理)      │ (替代入口)   │
 * ├─────────────────────────────────────────────────────────┤
 * │              card-data (22张大阿尔卡纳)                   │
 * ├─────────────────────────────────────────────────────────┤
 * │                    types (数据模型)                       │
 * └─────────────────────────────────────────────────────────┘
 */

// 数据类型
export * from './types';

// 牌面数据
export { MAJOR_ARCANA, getCardById, getCardByNumber, getSensitiveCards, getAllCardIds, EMOTION_CARD_MAP, THEME_CARD_MAP } from './card-data';

// 牌面匹配
export { CardMatcher, EmotionCardMatcher, ThemeCardMatcher, CardSelector } from './card-matcher';

// 交互管理
export { TarotInteractionManager, TarotSafetyChecker, GreetingGenerator } from './interaction';

// 叙事检测
export { NarrativeDetector, MetaphorManager } from './narrative';

// 替代入口
export { EntrySelector, IMAGE_ENTRIES, SCENARIO_ENTRIES, KEYWORD_ENTRIES, DIRECT_ENTRY } from './alternatives';
