import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, copyFileSync, constants } from 'node:fs';
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PythonStorage } from './python-storage';
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
const snapshotSchema = z.object({ version: z.union([z.literal(1), z.literal(2)]), sessions: z.array(recordSchema).max(2000), profiles: z.array(profileSchema).max(1000).optional() }).strict();
export interface StorageOptions { backend?: 'json' | 'sqlite'; pythonExecutable?: string }

/** Single-process, browser-owner scoped storage. Conversations and memory commit in one atomic snapshot. */
export class SessionStore {
  private records = new Map<string, RecordEntry>();
  private profiles = new Map<string, MemoryProfile>();
  private writer?: PythonStorage;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  readonly ready: Promise<void>;
  readonly backend: 'memory' | 'json' | 'sqlite';
  constructor(private file?: string, private ttlMs = 7 * 24 * 3600000, private capacity = 200, options: StorageOptions = {}) {
    this.backend = !file ? 'memory' : options.backend || 'json';
    if (file && this.backend === 'json' && existsSync(file.replace(/\.json$/i, '') + '.sqlite3')) {
      throw new Error('已有 SQLite 档案，请使用 SESSION_STORAGE=sqlite；旧 JSON 仅为迁移备份，不能自动恢复。');
    }
    if (file && this.backend === 'sqlite') {
      this.writer = new PythonStorage(file.replace(/\.json$/i, '') + '.sqlite3', options.pythonExecutable || 'python');
      this.ready = this.initializeSqlite();
      void this.ready.catch(() => {}); // Callers await ready; avoid an unhandled startup rejection.
    } else {
      if (file && existsSync(file)) this.loadJson();
      this.ready = Promise.resolve();
    }
  }
  private hydrate(raw: unknown) {
    const parsed = snapshotSchema.parse(raw);
    if (parsed.version === 2 && !parsed.profiles) throw new Error('Missing profiles');
    const records = new Map<string, RecordEntry>(), profiles = new Map<string, MemoryProfile>();
    for (const p of parsed.profiles || []) {
      if (profiles.has(p.owner)) throw new Error('Duplicate owner');
      profiles.set(p.owner, p);
    }
    for (const raw of parsed.sessions) {
      const item = raw as unknown as RecordEntry;
      if (parsed.version === 1) for (const turn of item.state.recentHistory) delete turn.memoryEpoch;
      if (item.state.userId !== item.owner || item.state.sessionId !== this.key(item.owner, item.id) || records.has(this.key(item.owner, item.id))) throw new Error('Invalid identity');
      if (parsed.version === 1 && item.state.explicitMemories?.length) {
        const p = profiles.get(item.owner) || emptyProfile(item.owner);
        for (const text of item.state.explicitMemories) if (!rejection(text)) {
          addCandidate(p, classifyStatement(text), { sessionId: item.id, turnId: 'legacy', now: item.updatedAt }, 'legacy', true);
        }
        profiles.set(item.owner, p);
      }
      delete item.state.explicitMemories;
      records.set(this.key(item.owner, item.id), item);
    }
    this.records = records; this.profiles = profiles;
    return parsed.version;
  }
  private loadJson() {
    const file = this.file!;
    try {
      const version = this.hydrate(JSON.parse(readFileSync(file, 'utf8')));
      const pruned = this.prune(this.records);
      if (version === 1) {
        if (!existsSync(file + '.v1.bak')) copyFileSync(file, file + '.v1.bak', constants.COPYFILE_EXCL);
      }
      if (this.backend === 'json' && (version === 1 || pruned)) {
        // One-time startup migration; normal requests use the asynchronous transaction path.
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file + '.tmp', JSON.stringify(this.snapshot(this.records, this.profiles)), { encoding: 'utf8', mode: 0o600 });
        renameSync(file + '.tmp', file);
      }
    } catch { throw new Error('无法读取会话文件。请先备份并检查 .data/sessions.json，原文件未覆盖。'); }
  }
  private async initializeSqlite() {
    try {
      let snapshot = await this.writer!.request('initialize', null);
      if (snapshot.needsSeed) {
        if (existsSync(this.file!)) this.loadJson();
        snapshot = await this.writer!.request('initialize', this.snapshot(this.records, this.profiles));
      }
      this.hydrate(snapshot);
      const before = new Map(this.records);
      if (this.prune(this.records)) await this.persist(this.records, this.profiles, before, this.profiles);
    } catch {
      await this.writer!.close().catch(() => {});
      throw new Error('无法初始化 Python SQLite 存储，请检查解释器和数据文件；未回退到旧 JSON。');
    }
  }
  private key(owner: string, id: string) { return `${owner}:${id}`; }
  private prune(records: Map<string, RecordEntry>) {
    let changed = false;
    for (const [key, entry] of records) if (Date.now() - entry.updatedAt > this.ttlMs) { records.delete(key); changed = true; }
    if (records.size > this.capacity) {
      for (const [key] of [...records].sort((a, b) => a[1].updatedAt - b[1].updatedAt).slice(0, records.size - this.capacity)) records.delete(key);
      changed = true;
    }
    return changed;
  }
  get(owner: string, id: string) {
    const entry = this.records.get(this.key(owner, id));
    return entry && Date.now() - entry.updatedAt <= this.ttlMs ? structuredClone(entry.state) : undefined;
  }
  getMemory(owner: string) { return structuredClone(this.profiles.get(owner) || emptyProfile(owner)); }
  private transaction(write: (records: Map<string, RecordEntry>, profiles: Map<string, MemoryProfile>) => void, signal?: AbortSignal) {
    if (this.closed) return Promise.reject(new Error('存储已关闭。'));
    const result = this.queue.then(async () => {
      await this.ready;
      signal?.throwIfAborted();
      const records = new Map(this.records), profiles = new Map(this.profiles);
      write(records, profiles); this.prune(records);
      signal?.throwIfAborted();
      await this.persist(records, profiles, this.records, this.profiles);
      // Reads continue seeing the previous committed state until durable acknowledgement.
      this.records = records; this.profiles = profiles;
    });
    this.queue = result.catch(() => {});
    return result;
  }
  private putMemory(profiles: Map<string, MemoryProfile>, owner: string, profile: MemoryProfile, revision: number) {
    if (profile.owner !== owner) throw new MemoryError('记忆身份不匹配。', 403);
    if ((profiles.get(owner)?.revision || 0) !== revision) throw new MemoryError('记忆已更新，请刷新后重试。', 409);
    if (!profiles.has(owner) && profiles.size >= 1000) throw new MemoryError('本机用户档案容量已满。', 409);
    profiles.set(owner, profile);
  }
  set(owner: string, id: string, state: SessionState, profile?: MemoryProfile, revision?: number, signal?: AbortSignal) {
    if (state.userId !== owner || state.sessionId !== this.key(owner, id)) throw new MemoryError('会话身份不匹配。', 403);
    const clean = structuredClone(state), pendingProfile = profile && profileSchema.parse(profile); delete clean.explicitMemories;
    return this.transaction((records, profiles) => {
      if (pendingProfile) this.putMemory(profiles, owner, pendingProfile, revision ?? -1);
      records.set(this.key(owner, id), { owner, id, state: clean, updatedAt: Date.now() });
    }, signal);
  }
  setMemory(owner: string, profile: MemoryProfile, revision: number) {
    const copy = profileSchema.parse(profile);
    return this.transaction((_records, profiles) => this.putMemory(profiles, owner, copy, revision));
  }
  delete(owner: string, id: string) { return this.transaction(records => { records.delete(this.key(owner, id)); }); }
  private snapshot(records: Map<string, RecordEntry>, profiles: Map<string, MemoryProfile>) {
    return { version: 2, sessions: [...records.values()], profiles: [...profiles.values()] };
  }
  private async persist(records: Map<string, RecordEntry>, profiles: Map<string, MemoryProfile>, previousRecords: Map<string, RecordEntry>, previousProfiles: Map<string, MemoryProfile>) {
    if (!this.file) return;
    if (this.writer) {
      await this.writer.request('commit', {
        sessions: [...records].filter(([key, entry]) => previousRecords.get(key) !== entry).map(([, entry]) => entry),
        deleted: [...previousRecords].filter(([key]) => !records.has(key)).map(([, entry]) => [entry.owner, entry.id]),
        profiles: [...profiles].filter(([key, profile]) => previousProfiles.get(key) !== profile).map(([, profile]) => profile),
      });
      return;
    }
    await mkdir(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(this.snapshot(records, profiles)), { encoding: 'utf8', mode: 0o600 });
      for (let attempt = 0; ; attempt++) {
        try { await rename(temp, this.file); break; }
        catch (error) {
          if (attempt >= 3 || !['EPERM', 'EBUSY', 'EACCES'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
          await new Promise(resolve => setTimeout(resolve, 10 * 2 ** attempt));
        }
      }
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {}); throw error;
    }
  }
  async close() { this.closed = true; await this.queue; await this.ready.catch(() => {}); await this.writer?.close(); }
}
