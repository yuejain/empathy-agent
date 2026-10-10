import { z } from 'zod';
import { experimentSchema } from './experiment-schema';
import { affectSchema } from '../affect/schema';

export const kindSchema = z.enum(['emotion', 'activity', 'decision', 'profile']);
export type MemoryKind = z.infer<typeof kindSchema>;
const time = z.number().finite().nonnegative();
export const evidenceSchema = z.object({ sessionId: z.string().max(180), turnId: z.string().max(100), quote: z.string().min(1).max(500), at: time }).strict();
export const entrySchema = z.object({
  id: z.string().uuid(), kind: kindSchema, key: z.string().min(1).max(160), text: z.string().min(1).max(500),
  status: z.enum(['active', 'pending', 'superseded', 'resolved']),
  source: z.enum(['explicit', 'statement', 'extracted', 'confirmed', 'legacy']),
  certainty: z.enum(['stated', 'inferred', 'tentative']),
  createdAt: time, updatedAt: time, expiresAt: time, reason: z.string().max(150),
  evidence: z.array(evidenceSchema).min(1).max(3), supersedes: z.array(z.string().uuid()).max(10).default([]),
  progress: z.enum(['planned', 'in_progress', 'blocked', 'completed', 'cancelled']).optional(), dueAt: time.optional(),
  experiment: experimentSchema.optional(),
  reflection: z.object({game:z.enum(['tarot','iching','needs','image','scenario','keyword']),choice:z.number().int().min(0).max(2)}).strict().optional(),
}).strict();
export type MemoryRecord = z.infer<typeof entrySchema>;
export const profileSchema = z.object({
  owner: z.string().min(1).max(100), revision: z.number().int().nonnegative(), contextEpoch: z.number().int().nonnegative(),
  settings: z.object({ capture: z.boolean(), recall: z.boolean() }).strict(),
  affect: affectSchema.optional(),
  entries: z.array(entrySchema).max(300),
  audit: z.array(z.object({ action: z.string().max(32), id: z.string().max(100), at: time }).strict()).max(100),
}).strict();
export type MemoryProfile = z.infer<typeof profileSchema>;
export interface MemoryOrigin { sessionId: string; turnId: string; now: number }
export interface Candidate { kind: MemoryKind; key: string; text: string; quote?: string; certain: boolean; resolve?: boolean; certainty?: MemoryRecord['certainty']; extracted?: boolean; replaces?: string[]; progress?: MemoryRecord['progress'] }
export const labels: Record<MemoryKind, string> = { emotion: '当前情绪', activity: '正在做的事', decision: '计划与决策', profile: '稳定背景' };
export const DAY = 86400000;
export const TTL: Record<MemoryKind, number> = { emotion: 6 * 3600000, activity: 30 * DAY, decision: 90 * DAY, profile: 365 * DAY };
export function emptyProfile(owner: string): MemoryProfile {
  return { owner, revision: 0, contextEpoch: 0, settings: { capture: true, recall: true }, entries: [], audit: [] };
}
