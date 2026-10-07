import { CardMatcher } from './card-matcher';

export type ReflectionGame = 'tarot' | 'iching' | 'needs';
export function requestedGame(text: string): ReflectionGame | undefined {
  if (/不想|不要|不抽|不用|停止|跳过/.test(text)) return;
  if (/周易|易经|八卦|六爻|掷.*(币|钱)/.test(text)) return 'iching';
  if (/情绪.*(卡|游戏)|需要卡|需求卡/.test(text)) return 'needs';
  if (/塔罗|抽.*牌/.test(text)) return 'tarot';
}

// Bottom line is the least significant bit. Traditional symbols; modern prompts are original.
// Reference: https://ctext.org/book-of-changes/shuo-gua
export const TRIGRAMS = [
  { name: '坤', symbol: '☷', image: '地', need: '被接住与休息', action: '为自己留出一段不必证明什么的时间' },
  { name: '震', symbol: '☳', image: '雷', need: '表达与启动', action: '把压在心里的一句话写下来' },
  { name: '坎', symbol: '☵', image: '水', need: '安全感与支持', action: '想一位可以联系、让你稍感安心的人' },
  { name: '兑', symbol: '☱', image: '泽', need: '连接与轻松', action: '回想一个让你感到被善待的片刻' },
  { name: '艮', symbol: '☶', image: '山', need: '边界与暂停', action: '辨认一件今天可以暂时放下的事' },
  { name: '离', symbol: '☲', image: '火', need: '被看见与清晰', action: '用一个词给此刻最强烈的感受命名' },
  { name: '巽', symbol: '☴', image: '风', need: '弹性与渐进', action: '选择一个不用一次完成的小步骤' },
  { name: '乾', symbol: '☰', image: '天', need: '自主与力量', action: '区分一件你能影响、和一件暂时无法控制的事' },
] as const;

export function castCoins(random = Math.random) {
  const lines = Array.from({ length: 6 }, () => Array.from({ length: 3 }, () => random() < .5 ? 2 : 3).reduce((a, b) => a + b, 0));
  const trigram = (values: number[]) => values.reduce((value, line, i) => value | ((line % 2) << i), 0);
  const changed = lines.map(line => line === 6 ? 7 : line === 9 ? 8 : line);
  return { lines, lower: trigram(lines.slice(0, 3)), upper: trigram(lines.slice(3)),
    changedLower: trigram(changed.slice(0, 3)), changedUpper: trigram(changed.slice(3)), moving: lines.flatMap((v, i) => v === 6 || v === 9 ? [i + 1] : []) };
}

export function reflectionGame(game: ReflectionGame, context: { userId: string; sessionId: string; emotion: string; intensity: number }, random = Math.random): string {
  if (game === 'tarot') {
    const card = new CardMatcher().selectCards({ userId: context.userId, sessionId: context.sessionId, trigger: 'user_request', currentEmotion: context.emotion, emotionIntensity: context.intensity }).cards[0];
    const reversed = random() < .5;
    return `塔罗联想 · ${card.displayName}（${reversed ? '逆位：从阻力与需要理解自己' : '正位：从资源与可能理解自己'}）\n\n${card.description}\n\nA. ${card.aspects.A}\nB. ${card.aspects.B}\nC. ${card.aspects.C}\n\n正逆位只是换一个观察角度，不代表吉凶，也不预测未来。可以选 A/B/C 继续聊，或说“都不像”“跳过”。`;
  }
  if (game === 'iching') {
    const cast = castCoins(random), lower = TRIGRAMS[cast.lower], upper = TRIGRAMS[cast.upper];
    const drawing = [...cast.lines].reverse().map(v => `${v % 2 ? '━━━━━━' : '━━  ━━'}${v === 6 || v === 9 ? '  ○ 变化' : ''}`).join('\n');
    return `周易意象 · 上${upper.name}${upper.symbol}下${lower.name}${lower.symbol}\n\n${drawing}\n\n规则：模拟六次三枚硬币，自下而上排爻。6/9 为变化爻，7/8 为稳定爻。${cast.moving.length ? `变化后为上${TRIGRAMS[cast.changedUpper].name}下${TRIGRAMS[cast.changedLower].name}。` : '这一轮没有变化爻。'}\n\nA. 内在的“${lower.image}”：此刻你是否需要${lower.need}？\nB. 外在的“${upper.image}”：环境是否让你想到${upper.need}？\nC. 一个小尝试：${lower.action}。\n\n这些情绪联想是现代练习，不是古籍断语或吉凶判断，不预测未来。可以选 A/B/C、讲自己的联想，或跳过。`;
  }
  const cards = [
    { title: '边界', emotion: /愤怒|挫败|anger/, need: '我的哪些界限希望被尊重？', action: '我愿意说的一句温和而明确的“不”是什么？' },
    { title: '连接', emotion: /孤独|悲伤|sadness/, need: '我想被谁听见，或怎样被陪伴？', action: '有哪些安全的人或地方，能让我少独自承担一点？' },
    { title: '安定', emotion: /焦虑|恐惧|fear/, need: '哪些信息或支持会让我更安心？', action: '眼下我能掌握的一小件事是什么？' },
    { title: '探索', emotion: /困惑|confusion/, need: '我是否需要多一点时间，而不是马上有答案？', action: '如果只做一个小实验，我愿意试哪一步？' },
    { title: '珍惜', emotion: /喜悦|感恩|joy|love/, need: '最近什么事情让我感到被滋养？', action: '我想怎样记录或延续这一刻？' },
  ];
  const card = cards.find(c => c.emotion.test(context.emotion)) || cards[Math.floor(random() * cards.length)];
  return `情绪需要卡 · ${card.title}\n\nA. 感受：试着补全“当……发生时，我感到……”。\nB. 需要：${card.need}\nC. 选择：${card.action}\n\n可以选 A/B/C 回答一个问题，也可以说“都不像”。卡片提供联想，不替你定义感受，不预测未来。`;
}
