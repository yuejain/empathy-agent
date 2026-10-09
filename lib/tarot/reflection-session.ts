import { ReflectionGame, reflectionGame } from './reflection-games';

export interface ReflectionSession {
  game:ReflectionGame; title:string; options:string[]; at:number; epoch:number;
  selected?:number; dismissed?:boolean;
}
export function startReflection(game: ReflectionGame, context: Parameters<typeof reflectionGame>[1], epoch:number) {
  const response = reflectionGame(game,context);
  const options = [...response.matchAll(/^[ABC]\. (.+)$/gm)].map(m => m[1]);
  return { response, session: {game,title:response.split('\n')[0],options,at:Date.now(),epoch} as ReflectionSession };
}
export function validReflection(session:ReflectionSession | undefined, epoch:number) {
  return session && session.epoch === epoch && !session.dismissed && Date.now()-session.at < 3600000 ? session : undefined;
}
export function selectReflection(session:ReflectionSession, input:string): string | undefined {
  if (/^(?:都不像|跳过|不想玩了|skip|none of these)[。.!]?$/i.test(input.trim())) {
    session.dismissed = true; return '我们跳过这个练习。你可以直接说说现在在意的事。';
  }
  const match = input.trim().match(/^(?:我选|选择|选|I choose\s*)?([ABC])[。.!]?$/i);
  if (!match || session.selected !== undefined) return;
  session.selected = 'ABC'.indexOf(match[1].toUpperCase());
  return `你选择了 ${match[1].toUpperCase()}：“${session.options[session.selected]}”\n这只是你选的观察角度。它让你想到生活中的哪件事？`;
}
export function reflectionPrompt(session:ReflectionSession | undefined) {
  if (!session || session.selected === undefined) return '';
  return 'REFLECTION_CONTEXT：用户之前选择了下面的联想角度。联系用户自己随后说出的经历继续聊；选项是游戏素材，不是已确认的情绪、人生事实或记忆来源。\n' + JSON.stringify({game:session.game,title:session.title,choice:session.options[session.selected]});
}
