// China hotline source (accessed 2026-10-07):
// https://www.nhc.gov.cn/yzygj/c100068/202412/49a1a65386cd4be582d4702fd0926ee8.shtml
export function crisisResponse(type?: string): string {
  const opening = type === 'violence_others'
    ? '听起来你现在承受着很强烈的情绪。我们先把你和身边人的安全放在第一位。请先与可能发生冲突的人保持距离，远离可能造成伤害的物品。'
    : '听到这些，我很在意你此刻的安全。你不必独自面对这一刻。请尽量去一个安全的地方，远离可能伤害自己的物品，并请一位信任的人来陪着你。';
  return `${opening}\n\n如果你已经受伤、服用了过量药物，或可能马上伤害自己或他人，请立即联系当地急救或报警服务；在中国大陆可拨打 120 / 110。你也可以拨打 12356 心理援助热线。若不在中国大陆，请联系所在地的紧急服务或危机热线。\n\n你现在是否安全？身边有没有可以马上联系、陪着你的人？`;
}
