import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { SessionState } from '../lib/orchestrator/types';
import { z } from 'zod';
interface RecordEntry { owner: string; id: string; updatedAt: number; state: SessionState }
const storedState = z.object({
  sessionId: z.string(), userId: z.string(), startedAt: z.string(), currentState: z.string(),
  turnCount: z.number().int().nonnegative(),
  recentHistory: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(32000), timestamp: z.string() })).max(20),
  emotionTrajectory: z.array(z.object({ intensity: z.number(), valence: z.number() })).max(50),
  stateHistory: z.array(z.object({ fromState: z.string(), toState: z.string() })).max(100),
  explicitMemories: z.array(z.string().max(500)).max(20).optional(),
}).passthrough();

/** Single-process local persistence. Session IDs alone never authorize access. */
export class SessionStore {
  private records = new Map<string, RecordEntry>();
  constructor(private file?: string, private ttlMs = 7 * 24 * 3600000, private capacity = 200) {
    if (file && existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) throw new Error('invalid');
        for (const item of parsed.sessions) {
          if (typeof item.owner !== 'string' || typeof item.id !== 'string' || !Number.isFinite(item.updatedAt) || !item.state || !Array.isArray(item.state.recentHistory) || !Array.isArray(item.state.emotionTrajectory) || !Number.isInteger(item.state.turnCount)) throw new Error('invalid');
          storedState.parse(item.state);
          this.records.set(this.key(item.owner, item.id), item);
        }
        if (this.prune()) this.save();
      } catch { throw new Error('无法读取会话文件。请先备份并检查 .data/sessions.json，原文件未覆盖。'); }
    }
  }
  private key(owner: string, id: string) { return `${owner}:${id}`; }
  private prune() {
    let changed = false;
    for (const [key, entry] of this.records) if (Date.now() - entry.updatedAt > this.ttlMs) { this.records.delete(key); changed = true; }
    while (this.records.size > this.capacity) {
      const oldest = [...this.records].sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0][0];
      this.records.delete(oldest); changed = true;
    }
    return changed;
  }
  get(owner: string, id: string) {
    if (this.prune()) this.save();
    const entry = this.records.get(this.key(owner, id));
    return entry ? structuredClone(entry.state) : undefined;
  }
  set(owner: string, id: string, state: SessionState) {
    const before = new Map(this.records);
    this.records.set(this.key(owner, id), { owner, id, state: structuredClone(state), updatedAt: Date.now() });
    this.prune();
    try { this.save(); } catch (error) { this.records = before; throw error; }
  }
  delete(owner: string, id: string) {
    const before = new Map(this.records);
    this.records.delete(this.key(owner, id));
    try { this.save(); } catch (error) { this.records = before; throw error; }
  }
  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify({ version: 1, sessions: [...this.records.values()] }), { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, this.file);
  }
}
