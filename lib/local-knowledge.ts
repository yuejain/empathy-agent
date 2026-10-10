import { z } from 'zod';

const emotionLabel = z.enum(['joy', 'sadness', 'anger', 'fear', 'love', 'surprise', 'confusion', 'neutral']);
const score = z.number().finite().min(0).max(1);
const hitSchema = z.object({ id: z.string().max(200), text: z.string().max(4000), response: z.string().max(4000).nullable(),
  source: z.string().max(200), source_url: z.string().url().max(1000), license: z.string().max(200), language: z.string().max(16),
  emotions: z.array(emotionLabel).max(8), category: z.string().max(100), score });
const analysisSchema = z.object({ emotion: emotionLabel, confidence: score,
  scores: z.record(emotionLabel, score), label_source: z.literal('local-trained-head'), hits: z.array(hitSchema).max(3), index_size: z.number().int().nonnegative(),
  memory_hits: z.array(z.object({id:z.string().uuid(),score:z.number().finite().min(-1).max(1)})).max(80).optional(),
  timings: z.object({encodeMs:z.number().nonnegative(),searchMs:z.number().nonnegative()}).optional() })
  .refine(data => {
    const primary = data.scores[data.emotion];
    return primary !== undefined && Math.abs(primary - data.confidence) <= .0001 && Object.values(data.scores).every(value => value! <= primary + .0001);
  }, 'Emotion summary must agree with the local scores');
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
    if (!this.url) return { available: false, role: 'emotion-rag', indexDocuments: 0 };
    try {
      const response = await fetch(this.url + '/health', { signal: AbortSignal.timeout(1500), redirect: 'error' });
      if (!response.ok) throw new Error();
      const data = await response.json() as any;
      return { available: data.ok === true && data.classifier === true, role: 'emotion-rag', indexDocuments: Number(data.index_documents) || 0 };
    } catch { return { available: false, role: 'emotion-rag', indexDocuments: 0 }; }
  }
  async maintenance(operation?: {action:'rebuild'|'update'|'retrain'|'rollback'} | {scheduleHours:0|24|168}) {
    if (!this.url) throw new Error('本地语料服务未连接。');
    const response = await fetch(this.url+'/maintenance',{method:operation ? 'POST' : 'GET',redirect:'error',
      headers:operation ? {'Content-Type':'application/json'} : {},body:operation ? JSON.stringify(operation) : undefined,signal:AbortSignal.timeout(3000)});
    if (!response.ok) throw new Error(response.status === 409 ? '已有语料更新任务在执行。' : '语料管理服务暂不可用。');
    const evaluation=z.record(z.object({examples:z.number().int().nonnegative(),macro_f1:z.number().finite().min(0).max(1)}));
    return z.object({status:z.enum(['idle','running','success','partial','failed','interrupted']),phase:z.enum(['idle','queued','collect','index','train']),
      model:z.object({activeVersion:z.string().max(40),canRollback:z.boolean(),candidate:z.object({version:z.string().max(40),passed:z.boolean(),reasons:z.array(z.string().max(200)).max(30),scope:z.array(z.string().max(100)).max(20),createdAt:z.string().max(50),evaluations:evaluation,baseline:evaluation}).nullable()}).optional(),
      scheduleHours:z.number().int().min(0).max(168),nextRunAt:z.number().nullable(),startedAt:z.string().optional(),finishedAt:z.string().nullable().optional()}).parse(await response.json());
  }
  async analyze(text: string, signal?: AbortSignal, retrieval?: { query:string; memories:{id:string;text:string}[] }): Promise<KnowledgeResult | undefined> {
    if (!this.url) return;
    try {
      const response = await fetch(this.url + '/analyze', { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, ...(retrieval ? {query:retrieval.query,memories:retrieval.memories} : {}) }), signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]) });
      if (!response.ok) return;
      return analysisSchema.parse(await response.json());
    } catch { signal?.throwIfAborted(); return; }
  }
}
