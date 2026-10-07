/**
 * 安全分类器 - 关键词库与正则模板
 *
 * 按风险子类组织，每个关键词标注风险等级和权重
 * 采用"召回优先"原则：宁可多报，不可漏报
 */

import { RiskLevel, CrisisSubtype } from './types';

// ==================== 关键词条目 ====================

export interface CrisisKeywordEntry {
  keyword: string;
  category: string;           // 风险子类别
  riskLevel: RiskLevel;
  weight: number;             // 0-1
  subtype: CrisisSubtype;
}

// ==================== 关键词库 ====================

export const CRISIS_KEYWORDS: CrisisKeywordEntry[] = [
  { keyword: '服药过量', category: '自伤行为', riskLevel: 'L2', weight: 1, subtype: 'suicide_self_harm' },
  { keyword: '吞了整瓶', category: '自伤行为', riskLevel: 'L2', weight: 1, subtype: 'suicide_self_harm' },
  // ========== 自杀/自伤类 ==========
  // L2 高危关键词
  { keyword: '想死', category: '自杀意念', riskLevel: 'L2', weight: 0.95, subtype: 'suicide_self_harm' },
  { keyword: '不想活', category: '自杀意念', riskLevel: 'L2', weight: 0.95, subtype: 'suicide_self_harm' },
  { keyword: '不想活了', category: '自杀意念', riskLevel: 'L2', weight: 0.98, subtype: 'suicide_self_harm' },
  { keyword: '死了算了', category: '自杀意念', riskLevel: 'L2', weight: 0.95, subtype: 'suicide_self_harm' },
  { keyword: '结束生命', category: '自杀意念', riskLevel: 'L2', weight: 0.95, subtype: 'suicide_self_harm' },
  { keyword: '结束一切', category: '自杀意念', riskLevel: 'L2', weight: 0.90, subtype: 'suicide_self_harm' },
  { keyword: '自杀', category: '自杀意念', riskLevel: 'L2', weight: 0.90, subtype: 'suicide_self_harm' },
  { keyword: '活不下去', category: '自杀意念', riskLevel: 'L2', weight: 0.92, subtype: 'suicide_self_harm' },
  { keyword: '活着没意思', category: '无望感', riskLevel: 'L2', weight: 0.88, subtype: 'suicide_self_harm' },
  { keyword: '活着太累', category: '无望感', riskLevel: 'L2', weight: 0.85, subtype: 'suicide_self_harm' },
  { keyword: '解脱', category: '自杀意念', riskLevel: 'L1', weight: 0.60, subtype: 'suicide_self_harm' },
  { keyword: '消失', category: '自杀意念', riskLevel: 'L1', weight: 0.50, subtype: 'suicide_self_harm' },

  // 自伤方法
  { keyword: '割腕', category: '自伤方法', riskLevel: 'L2', weight: 0.95, subtype: 'suicide_self_harm' },
  { keyword: '跳楼', category: '自伤方法', riskLevel: 'L2', weight: 0.95, subtype: 'suicide_self_harm' },
  { keyword: '上吊', category: '自伤方法', riskLevel: 'L2', weight: 0.95, subtype: 'suicide_self_harm' },
  { keyword: '服药过量', category: '自伤方法', riskLevel: 'L2', weight: 0.95, subtype: 'suicide_self_harm' },
  { keyword: '割伤自己', category: '自伤行为', riskLevel: 'L2', weight: 0.90, subtype: 'suicide_self_harm' },
  { keyword: '伤害自己', category: '自伤行为', riskLevel: 'L2', weight: 0.90, subtype: 'suicide_self_harm' },
  { keyword: '自残', category: '自伤行为', riskLevel: 'L2', weight: 0.90, subtype: 'suicide_self_harm' },

  // 无望感（L1-L2）
  { keyword: '没有出路', category: '无望感', riskLevel: 'L1', weight: 0.70, subtype: 'suicide_self_harm' },
  { keyword: '永远不会好', category: '无望感', riskLevel: 'L1', weight: 0.65, subtype: 'suicide_self_harm' },
  { keyword: '绝望', category: '无望感', riskLevel: 'L1', weight: 0.60, subtype: 'suicide_self_harm' },
  { keyword: '没有希望', category: '无望感', riskLevel: 'L1', weight: 0.55, subtype: 'suicide_self_harm' },
  { keyword: '看不到未来', category: '无望感', riskLevel: 'L1', weight: 0.55, subtype: 'suicide_self_harm' },
  { keyword: '生不如死', category: '无望感', riskLevel: 'L2', weight: 0.90, subtype: 'suicide_self_harm' },

  // ========== 他伤/暴力类 ==========
  { keyword: '杀了他', category: '他伤威胁', riskLevel: 'L2', weight: 0.90, subtype: 'violence_others' },
  { keyword: '杀了她', category: '他伤威胁', riskLevel: 'L2', weight: 0.90, subtype: 'violence_others' },
  { keyword: '杀了他们', category: '他伤威胁', riskLevel: 'L2', weight: 0.90, subtype: 'violence_others' },
  { keyword: '伤害别人', category: '他伤威胁', riskLevel: 'L2', weight: 0.85, subtype: 'violence_others' },
  { keyword: '报复', category: '暴力倾向', riskLevel: 'L1', weight: 0.50, subtype: 'violence_others' },
  { keyword: '让他们付出代价', category: '暴力倾向', riskLevel: 'L1', weight: 0.55, subtype: 'violence_others' },

  // ========== 虐待类 ==========
  { keyword: '打我', category: '遭受虐待', riskLevel: 'L1', weight: 0.60, subtype: 'abuse' },
  { keyword: '虐待', category: '虐待', riskLevel: 'L1', weight: 0.65, subtype: 'abuse' },
  { keyword: '家暴', category: '家庭暴力', riskLevel: 'L1', weight: 0.65, subtype: 'abuse' },
  { keyword: '被欺负', category: '欺凌', riskLevel: 'L1', weight: 0.55, subtype: 'abuse' },

  // ========== 急性精神病类 ==========
  { keyword: '幻觉', category: '精神病症状', riskLevel: 'L1', weight: 0.60, subtype: 'acute_psychosis' },
  { keyword: '妄想', category: '精神病症状', riskLevel: 'L1', weight: 0.60, subtype: 'acute_psychosis' },
  { keyword: '听到声音', category: '幻听', riskLevel: 'L1', weight: 0.55, subtype: 'acute_psychosis' },
  { keyword: '有人在监视我', category: '被害妄想', riskLevel: 'L1', weight: 0.60, subtype: 'acute_psychosis' },
  { keyword: '躁狂', category: '躁狂发作', riskLevel: 'L1', weight: 0.55, subtype: 'acute_psychosis' },

  // ========== L1 关注类 ==========
  { keyword: '失眠', category: '睡眠问题', riskLevel: 'L1', weight: 0.30, subtype: 'none' },
  { keyword: '睡不着', category: '睡眠问题', riskLevel: 'L1', weight: 0.30, subtype: 'none' },
  { keyword: '抑郁', category: '情绪问题', riskLevel: 'L1', weight: 0.40, subtype: 'none' },
  { keyword: '焦虑', category: '情绪问题', riskLevel: 'L1', weight: 0.35, subtype: 'none' },
  { keyword: '崩溃', category: '情绪崩溃', riskLevel: 'L1', weight: 0.45, subtype: 'none' },
  { keyword: '撑不下去', category: '压力过大', riskLevel: 'L1', weight: 0.50, subtype: 'none' },
  { keyword: '受不了', category: '压力过大', riskLevel: 'L1', weight: 0.40, subtype: 'none' },
  { keyword: '无望', category: '无望感', riskLevel: 'L1', weight: 0.45, subtype: 'none' },
];

// ==================== 正则模式 ====================

export interface CrisisPatternEntry {
  name: string;
  pattern: string;           // 正则表达式
  riskLevel: RiskLevel;
  category: string;
  description: string;
}

export const CRISIS_PATTERNS: CrisisPatternEntry[] = [
  { name: '已经过量服药', pattern: '(吃|吞|服).{0,8}(大量|很多|一大把|一把|整瓶|过量).{0,5}(药|安眠|止痛)', riskLevel: 'L2', category: '自伤行为', description: '已发生的潜在药物过量' },

  // ========== 自杀意念变体 ==========
  {
    name: '想死变体',
    pattern: '想.{0,3}(死|消失|解脱|结束)',
    riskLevel: 'L2',
    category: '自杀意念',
    description: '匹配"想死"、"想消失"、"想解脱"等变体',
  },
  {
    name: '不想活变体',
    pattern: '不.{0,2}想.{0,2}活',
    riskLevel: 'L2',
    category: '自杀意念',
    description: '匹配"不想活"、"不想再活"等变体',
  },
  {
    name: '结束生命变体',
    pattern: '(结束|终结|了结).{0,3}(生命|一切|自己|痛苦)',
    riskLevel: 'L2',
    category: '自杀意念',
    description: '匹配"结束生命"、"了结一切"等变体',
  },
  {
    name: '告别行为',
    pattern: '(永别|再见|来世|下辈子).{0,5}(了|吧|保重)',
    riskLevel: 'L2',
    category: '告别行为',
    description: '匹配告别性语言',
  },
  {
    name: '具体计划',
    pattern: '(已经|已经想好|计划|准备).{0,5}(怎么|如何).{0,5}(死|结束|离开)',
    riskLevel: 'L2',
    category: '具体计划',
    description: '匹配有具体自杀计划的表达',
  },

  // ========== 自伤行为 ==========
  {
    name: '割伤变体',
    pattern: '(割|切|划).{0,3}(腕|手臂|自己|皮肤)',
    riskLevel: 'L2',
    category: '自伤行为',
    description: '匹配割伤相关表达',
  },
  {
    name: '撞墙变体',
    pattern: '(撞|砸).{0,3}(墙|头|东西)',
    riskLevel: 'L1',
    category: '自伤行为',
    description: '匹配撞墙等自伤行为',
  },

  // ========== 无望感 ==========
  {
    name: '永远不会好',
    pattern: '(永远|再也|一辈子).{0,3}(不会|不能).{0,3}(好|改变|好转)',
    riskLevel: 'L1',
    category: '无望感',
    description: '匹配"永远不会好"等无望表达',
  },
  {
    name: '没有意义',
    pattern: '(活着|人生|一切|什么).{0,3}(没有|毫无).{0,3}(意义|意思|价值)',
    riskLevel: 'L1',
    category: '无望感',
    description: '匹配"活着没有意义"等表达',
  },

  // ========== 他伤威胁 ==========
  {
    name: '杀人威胁',
    pattern: '(杀|弄死|干掉|搞死).{0,3}(他|她|他们|所有人)',
    riskLevel: 'L2',
    category: '他伤威胁',
    description: '匹配杀人威胁',
  },
  {
    name: '暴力威胁',
    pattern: '(打|揍|教训|收拾).{0,3}(死|残|废)',
    riskLevel: 'L2',
    category: '他伤威胁',
    description: '匹配暴力威胁',
  },

  // ========== 精神病症状 ==========
  {
    name: '幻听描述',
    pattern: '(听到|有人).{0,5}(声音|说话|叫我|命令我)',
    riskLevel: 'L1',
    category: '幻听',
    description: '匹配幻听描述',
  },
  {
    name: '被害妄想',
    pattern: '(有人|他们).{0,5}(监视|跟踪|要害|下毒|控制)',
    riskLevel: 'L1',
    category: '被害妄想',
    description: '匹配被害妄想描述',
  },
];

// ==================== 否定模式 ====================

/** 否定词列表 - 用于降低误报 */
export const NEGATION_PATTERNS: string[] = [
  '不', '没', '别', '无', '未', '非',
  '不是', '不会', '不要', '不能', '没有',
  '从未', '绝不', '从不',
  '朋友说', '别人说', '他说', '她说', '新闻里',
];

// ==================== 引号模式 ====================

/** 引号匹配模式 - 用于识别引用他人的话 */
export const QUOTATION_PATTERNS: string[] = [
  '"([^"]*)"',
  "'([^']*)'",
  '「([^」]*)」',
  '『([^』]*)』',
  '（([^）]*)）',
  '\\\u201c([^\\\u201d]*)\\\u201d',  // 中文双引号
];

// ==================== 危机协议定义 ====================

export interface CrisisProtocol {
  id: string;
  name: string;
  subtype: CrisisSubtype;
  responseTemplate: string;
  resources: string[];
  actions: string[];
}

export const CRISIS_PROTOCOLS: CrisisProtocol[] = [
  {
    id: 'protocol_a',
    name: '自杀/自伤危机协议',
    subtype: 'suicide_self_harm',
    responseTemplate: `我听到你说"{userInput}"，这听起来你正在经历非常大的痛苦。我真的很关心你的安全。

你的生命很重要，有人在乎你。我强烈建议你联系专业的心理健康服务：

**24小时心理援助热线**：
- 全国心理援助热线：400-161-9995
- 北京心理危机研究与干预中心：010-82951332
- 生命热线：400-821-1215

如果你正处于紧急危险中，请立即拨打 120 或联系你信任的人。`,
    resources: ['400-161-9995', '010-82951332', '400-821-1215', '120'],
    actions: ['terminate_exploration', 'provide_resources', 'suggest_emergency_contact'],
  },
  {
    id: 'protocol_b',
    name: '他伤/暴力危机协议',
    subtype: 'violence_others',
    responseTemplate: `我注意到你提到了伤害他人的想法。我理解你可能正在经历强烈的愤怒或痛苦。

但我必须提醒你，伤害他人不仅会伤害别人，也会给你自己带来严重后果。

如果你感到无法控制自己的冲动，请立即：
- 联系紧急服务：110
- 离开当前环境，找一个安全的地方
- 与信任的人谈谈你的感受`,
    resources: ['110'],
    actions: ['terminate_conversation', 'suggest_police'],
  },
  {
    id: 'protocol_c',
    name: '虐待危机协议',
    subtype: 'abuse',
    responseTemplate: `我听到你正在经历一些困难的情况。你的安全是最重要的。

如果你正在遭受虐待或暴力，以下资源可以提供帮助：
- 全国妇联维权热线：12338
- 报警电话：110
- 未成年人保护热线：12355

你不需要独自面对这些问题。`,
    resources: ['12338', '110', '12355'],
    actions: ['provide_resources', 'safety_assessment'],
  },
  {
    id: 'protocol_d',
    name: '急性精神病危机协议',
    subtype: 'acute_psychosis',
    responseTemplate: `我注意到你可能正在经历一些不寻常的感受。这些感受可能是真实的，但也可能是你的身心在发出需要帮助的信号。

我建议你尽快联系专业的精神健康服务：
- 精神卫生中心热线：12320
- 急救电话：120

如果你感到不安全或无法控制自己，请立即寻求周围人的帮助。`,
    resources: ['12320', '120'],
    actions: ['grounding_response', 'suggest_emergency_medical'],
  },
];
