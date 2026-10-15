import { MemoryProfile } from '../memory/schema';
import { eligible } from '../memory/policy';
import { ReflectionGame, reflectionGame, requestsGameRecommendation } from './reflection-games';
import { ReflectionSession, startReflection, selectReflection } from './reflection-session';
import { EntrySelector } from './alternatives';
import { currentCycle } from '../memory/experiments';

// Themes only come from a small explicit vocabulary found in valid user statements.
const THEME_WORDS: [string, RegExp][] = [
  ['自主', /自主|autonomy/i], ['稳定', /稳定|stability/i], ['成长', /成长|growth/i],
  ['连接', /连接|亲密|connection/i], ['创造', /创造|创作|creativ/i], ['意义', /意义|meaning/i],
  ['安全', /安全|safety|security/i], ['自由', /自由|freedom/i],
];
const CONFLICT_WORDS: [string, RegExp][] = [
  ['怕失败', /怕失败|afraid.{0,8}fail/i], ['选择困难', /选择困难|很难选择|hard to choose/i],
  ['职业迷茫', /职业迷茫|工作迷茫|career uncertainty/i], ['关系困惑', /关系困惑|relationship confusion/i],
  ['自我怀疑', /自我怀疑|self.doubt/i], ['压力过大', /压力太大|压力过大|too much pressure/i],
];

export function reflectionContext(profile: MemoryProfile | undefined, context: Parameters<typeof reflectionGame>[1], now=Date.now()) {
  if (!profile?.settings.recall) return {...context,knownThemes:[],knownConflicts:[]};
  const texts = profile.entries.filter(e => eligible(e,now) && e.certainty==='stated' && e.kind!=='emotion')
    .sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,20).map(e => {
      const cycle=currentCycle(e);
      return [e.text,cycle?.values?.text,cycle?.constraints?.text].filter(Boolean).join(' ');
    }).join('\n');
  return {...context,knownThemes:THEME_WORDS.filter(([,pattern])=>pattern.test(texts)).map(([tag])=>tag).slice(0,6),
    knownConflicts:CONFLICT_WORDS.filter(([,pattern])=>pattern.test(texts)).map(([tag])=>tag).slice(0,4)};
}

/** Interaction state belongs to the persisted conversation, never a second process-local user profile. */
export class TarotInteractionManager {
  start(game:ReflectionGame, context:Parameters<typeof reflectionGame>[1], epoch:number, profile?:MemoryProfile) { return startReflection(game,profile ? reflectionContext(profile,context) : context,epoch); }
  select(session:ReflectionSession,input:string) { return selectReflection(session,input); }
  recommend(input:string,emotion:string,profile:MemoryProfile,previousGame?:ReflectionGame):string | undefined {
    if (!requestsGameRecommendation(input)) return;
    const preferred=this.preferredEntry(profile);
    if(preferred==='direct')return '你之前更希望直接聊。我们可以从现在在意的事说起；如果这次想试联想练习，也可以在游戏菜单自己选择。';
    let type=preferred || new EntrySelector().recommendByEmotion(emotion);
    if (previousGame===type && /换一种|another/i.test(input)) type=type==='scenario'?'keyword':'scenario';
    const names:Record<string,string>={tarot:'塔罗联想',iching:'周易意象',needs:'情绪需要卡',image:'意象联想（文字画面）',scenario:'场景联想',keyword:'关键词联想'};
    return `可以试试“${names[type]}”。这是一个可选的联想入口，不是对你的判断。想试时在游戏菜单选择它，或直接告诉我；也可以继续聊天。`;
  }
  preferredEntry(profile:MemoryProfile):ReflectionGame | 'direct' | undefined {
    if (!profile.settings.recall) return;
    const preference=profile.entries.filter(e=>eligible(e,Date.now()) && e.key==='profile:entry').sort((a,b)=>b.updatedAt-a.updatedAt)[0];
    if (!preference) return;
    if (/不喜欢|dislike/i.test(preference.text)) return 'direct';
    return /塔罗|tarot/i.test(preference.text) ? 'tarot' : /周易|iching/i.test(preference.text) ? 'iching'
      : /场景|scenario/i.test(preference.text) ? 'scenario' : /意象|imagery/i.test(preference.text) ? 'image'
      : /关键词/i.test(preference.text) ? 'keyword' : 'needs';
  }
}
