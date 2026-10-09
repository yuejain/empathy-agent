import { MemoryProfile } from '../memory/schema';
import { eligible } from '../memory/policy';

/** A narrative is the user's own dated reflections, never a personality inferred from card draws. */
export class NarrativeDetector {
  summarize(profile:MemoryProfile) {
    if (!profile.settings.recall) return [];
    return profile.entries.filter(e=>e.reflection && eligible(e,Date.now())).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,5)
      .map(e=>({id:e.id,game:e.reflection!.game,choice:e.reflection!.choice,statement:e.text,certainty:e.certainty,reportedAt:e.updatedAt}));
  }
}
