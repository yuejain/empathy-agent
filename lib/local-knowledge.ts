import { z } from 'zod';

const hitSchema = z.object({ id: z.string(), text: z.string().max(4000), response: z.string().nullable(),
  source: z.string(), source_url: z.string().url(), license: z.string(), language: z.string(),
  emotions: z.array(z.string()), category: z.string(), score: z.number().finite() });
const analysisSchema = z.object({ emotion: z.string(), confidence: z.number().min(0).max(1),
  scores: z.record(z.number().min(0).max(1)), label_source: z.string(), hits: z.array(hitSchema).max(3), index_size: z.number() });
export type KnowledgeResult = z.infer<typeof analysisSchema>;
export type KnowledgeHit = z.infer<typeof hitSchema>;
export const localEmotions: Record<string, { name: string; valence: number; arousal: number }> = {
  joy: { name: '喜悦', valence: .65, arousal: .65 }, sadness: { name: '悲伤', valence: -.65, arousal: .3 },
  anger: { name: '愤怒', valence: -.6, arousal: .8 }, fear: { name: '焦虑', valence: -.6, arousal: .7 },
  love: { name: '被爱/被关心', valence: .65, arousal: .4 }, surprise: { name: '惊讶', valence: 0, arousal: .7 },
  confusion: { name: '困惑', valence: -.2, arousal: .4 }, neutral: { name: '未明确', valence: 0, arousal: .3 },
};

export class LocalKnowledge {
  readonly url?: string;
  constructor(env: Record<string, string | undefined>) {
    if (env.LOCAL_ML_URL) {
      const url = new URL(env.LOCAL_ML_URL);
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error('LOCAL_ML_URL 必须是本机 HTTP 地址。');
      this.url = url.origin;
    }
  }
  async health() {
    if (!this.url) return { available: false, generator: false, indexDocuments: 0 };
    try {
      const response = await fetch(this.url + '/health', { signal: AbortSignal.timeout(1500), redirect: 'error' });
      if (!response.ok) throw new Error();
      const data = await response.json() as any;
      return { available: data.ok === true, generator: data.generator === true, indexDocuments: Number(data.index_documents) || 0 };
    } catch { return { available: false, generator: false, indexDocuments: 0 }; }
  }
  async analyze(text: string, signal?: AbortSignal): Promise<KnowledgeResult | undefined> {
    if (!this.url) return;
    try {
      const response = await fetch(this.url + '/analyze', { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }), signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]) });
      if (!response.ok) return;
      return analysisSchema.parse(await response.json());
    } catch { signal?.throwIfAborted(); return; }
  }
}
