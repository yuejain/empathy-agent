import { MemoryProfile } from '../memory/schema';
import { eligible } from '../memory/policy';
import { ReflectionGame, reflectionGame } from './reflection-games';
import { ReflectionSession, startReflection, selectReflection } from './reflection-session';

/** Interaction state belongs to the persisted conversation, never a second process-local user profile. */
export class TarotInteractionManager {
  start(game:ReflectionGame, context:Parameters<typeof reflectionGame>[1], epoch:number) { return startReflection(game,context,epoch); }
  select(session:ReflectionSession,input:string) { return selectReflection(session,input); }
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
