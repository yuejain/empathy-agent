import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, copyFileSync, constants } from 'node:fs';
import { dirname } from 'node:path';
import { SessionState } from '../lib/orchestrator/types';
import { addCandidate, classifyStatement, emptyProfile, MemoryError, MemoryProfile, profileSchema, rejection } from '../lib/memory';
import { z } from 'zod';

const storedState = z.object({
  sessionId: z.string(), userId: z.string(), startedAt: z.string(), currentState: z.string(),
  turnCount: z.number().int().nonnegative(),
  recentHistory: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(32000), timestamp: z.string(), memoryEpoch: z.number().int().nonnegative().optional() }).passthrough()).max(20),
  emotionTrajectory: z.array(z.object({ intensity: z.number(), valence: z.number() }).passthrough()).max(50),
  stateHistory: z.array(z.object({ fromState: z.string(), toState: z.string() }).passthrough()).max(100),
  explicitMemories: z.array(z.string().max(500)).max(20).optional(),
}).passthrough();
const recordSchema = z.object({ owner: z.string().min(1).max(100), id: z.string().min(1).max(100), updatedAt: z.number().finite().nonnegative(), state: storedState });
interface RecordEntry { owner: string; id: string; updatedAt: number; state: SessionState }

/** Single-process, browser-owner scoped storage. Conversations and memory commit in one atomic snapshot. */
export class SessionStore {
  private records = new Map<string, RecordEntry>();
  private profiles = new Map<string, MemoryProfile>();
  constructor(private file?: string, private ttlMs = 7 * 24 * 3600000, private capacity = 200) {
    if (!file || !existsSync(file)) return;
    try {
      const parsed = z.object({ version: z.union([z.literal(1), z.literal(2)]), sessions: z.array(recordSchema).max(2000), profiles: z.array(profileSchema).max(1000).optional() }).strict().parse(JSON.parse(readFileSync(file, 'utf8')));
      if (parsed.version === 2 && !parsed.profiles) throw new Error('Missing profiles');
      for (const p of parsed.profiles || []) {
        if (this.profiles.has(p.owner)) throw new Error('Duplicate owner');
        this.profiles.set(p.owner, p);
      }
      for (const raw of parsed.sessions) {
        const item = raw as unknown as RecordEntry;
        if (parsed.version === 1) for (const turn of item.state.recentHistory) delete turn.memoryEpoch;
        if (item.state.userId !== item.owner || item.state.sessionId !== this.key(item.owner, item.id) || this.records.has(this.key(item.owner, item.id))) throw new Error('Invalid identity');
        if (parsed.version === 1 && item.state.explicitMemories?.length) {
          const p = this.profiles.get(item.owner) || emptyProfile(item.owner);
          for (const text of item.state.explicitMemories) if (!rejection(text)) {
            addCandidate(p, classifyStatement(text), { sessionId: item.id, turnId: 'legacy', now: item.updatedAt }, 'legacy', true);
          }
          this.profiles.set(item.owner, p);
        }
        delete item.state.explicitMemories;
        this.records.set(this.key(item.owner, item.id), item);
      }
      const pruned = this.prune();
      if (parsed.version === 1) {
        if (!existsSync(file + '.v1.bak')) copyFileSync(file, file + '.v1.bak', constants.COPYFILE_EXCL);
        this.save();
      } else if (pruned) this.save();
    } catch { throw new Error('无法读取会话文件。请先备份并检查 .data/sessions.json，原文件未覆盖。'); }
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
    const entry = this.records.get(this.key(owner, id));
    return entry && Date.now() - entry.updatedAt <= this.ttlMs ? structuredClone(entry.state) : undefined;
  }
  getMemory(owner: string) { return structuredClone(this.profiles.get(owner) || emptyProfile(owner)); }
  private transaction(write: () => void) {
    const records = new Map(this.records), profiles = new Map(this.profiles);
    try { write(); this.prune(); this.save(); }
    catch (error) { this.records = records; this.profiles = profiles; throw error; }
  }
  private putMemory(owner: string, profile: MemoryProfile, revision: number) {
    if (profile.owner !== owner) throw new MemoryError('记忆身份不匹配。', 403);
    if ((this.profiles.get(owner)?.revision || 0) !== revision) throw new MemoryError('记忆已更新，请刷新后重试。', 409);
    if (!this.profiles.has(owner) && this.profiles.size >= 1000) throw new MemoryError('本机用户档案容量已满。', 409);
    this.profiles.set(owner, profileSchema.parse(profile));
  }
  set(owner: string, id: string, state: SessionState, profile?: MemoryProfile, revision?: number) {
    if (state.userId !== owner || state.sessionId !== this.key(owner, id)) throw new MemoryError('会话身份不匹配。', 403);
    this.transaction(() => {
      if (profile) this.putMemory(owner, profile, revision ?? -1);
      const clean = structuredClone(state); delete clean.explicitMemories;
      this.records.set(this.key(owner, id), { owner, id, state: clean, updatedAt: Date.now() });
    });
  }
  setMemory(owner: string, profile: MemoryProfile, revision: number) { this.transaction(() => this.putMemory(owner, profile, revision)); }
  delete(owner: string, id: string) { this.transaction(() => { this.records.delete(this.key(owner, id)); }); }
  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify({ version: 2, sessions: [...this.records.values()], profiles: [...this.profiles.values()] }), { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, this.file);
  }
}
