import { randomUUID } from 'node:crypto';
import { Candidate, DAY, MemoryOrigin, MemoryProfile, MemoryRecord, TTL, labels, kindSchema } from './schema';
import { ambiguous, eligible, fingerprint, historical, normalize, question, rejection, tentative } from './policy';
import { classifyStatement, extractStatements } from './extractor';
import { z } from 'zod';

export class MemoryError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
function audit(p: MemoryProfile, action: string, id: string, now: number) {
  p.audit.push({ action, id, at: now }); p.audit = p.audit.slice(-100); p.revision++;
}
function duration(c: Candidate) {
  return c.kind === 'emotion' && c.certainty === 'inferred' ? 3600000 : TTL[c.kind];
}
export function addCandidate(p: MemoryProfile, c: Candidate, origin: MemoryOrigin, source: MemoryRecord['source'], pending = false): MemoryRecord {
  const reason = rejection(c.text) || rejection(c.quote || c.text); if (reason) throw new MemoryError(reason);
  const now = origin.now, text = normalize(c.text);
  p.entries = p.entries.filter(e => e.expiresAt + 30 * DAY > now);
  const existing = p.entries.find(e => e.kind === c.kind && e.status === (pending ? 'pending' : c.resolve ? 'resolved' : 'active') && fingerprint(e.text) === fingerprint(text));
  const evidence = { sessionId: origin.sessionId, turnId: origin.turnId, quote: c.quote || c.text, at: now };
  if (existing) {
    existing.updatedAt = now; existing.expiresAt = now + duration(c);
    existing.certainty = c.certainty || (c.certain ? 'stated' : 'inferred'); existing.source = source;
    existing.evidence = [...existing.evidence, evidence].slice(-3);
    audit(p, 'refresh', existing.id, now); return existing;
  }
  const conflicts = pending ? [] : p.entries.filter(e => e.status === 'active' && (e.key === c.key || e.kind === c.kind && c.replaces?.includes(e.id)));
  if (p.entries.length >= 300) {
    const disposable = p.entries.filter(e => !eligible(e, now) || conflicts.includes(e)).sort((a, b) => a.updatedAt - b.updatedAt)[0];
    if (!disposable) throw new MemoryError('记忆已达 300 条，请先整理或删除部分记忆。', 409);
    p.entries = p.entries.filter(e => e.id !== disposable.id);
  }
  for (const old of conflicts) { old.status = 'superseded'; old.reason = '被更新的用户信息替代'; }
  if (conflicts.length) p.contextEpoch++; // Old assistant/history content must not reintroduce obsolete facts.
  const entry: MemoryRecord = { id: randomUUID(), kind: c.kind, key: c.key, text,
    status: pending ? 'pending' : c.resolve ? 'resolved' : 'active', source,
    certainty: c.certainty || (c.certain ? 'stated' : 'inferred'),
    createdAt: now, updatedAt: now, expiresAt: now + duration(c), evidence: [evidence], supersedes: conflicts.slice(-10).map(e => e.id),
    reason: pending ? '旧记录或不明确内容，等待核对' : c.resolve ? '用户已完成或撤回' : '来自用户原话；不是客观核验结论',
  };
  p.entries.push(entry); audit(p, pending ? 'propose' : c.resolve ? 'resolve' : 'write', entry.id, now); return entry;
}
export function clearMemories(p: MemoryProfile, now: number) {
  p.entries = []; p.audit = []; p.contextEpoch++; audit(p, 'clear', '', now);
}
export function memoryCommand(input: string): 'remember' | 'forget' | 'list' | undefined {
  if (/^(?:请)?(?:帮我)?(?:记住|更正记忆)[：:\s]*.+|^(?:remember|correct memory):\s*.+/i.test(input) && !/记住了什么/.test(input)) return 'remember';
  if (/^(?:请)?(?:忘记|清除)(?:所有|全部|这些)?(?:长期)?(?:记忆|记住的内容)[。！!]?$/u.test(input.trim()) || /^forget all memories[.!]?$/i.test(input)) return 'forget';
  if (/记住了什么|有哪些记忆|记得.*(?:什么|名字|叫)|我叫什么|what (?:do you remember|is my name)/i.test(input)) return 'list';
}
export function prepareMemory(profile: MemoryProfile, input: string, origin: MemoryOrigin, inferred: Candidate[] = []) {
  const p = structuredClone(profile), command = memoryCommand(input); let reply: string | undefined;
  if (command === 'forget') {
    clearMemories(p, origin.now);
    reply = '已清除所有跨会话记忆，旧聊天内容也不会再用于后续模型上下文。界面中的聊天文字仍保留，可用“清除记录”删除。';
  } else if (command === 'remember') {
    const text = input.replace(/^(?:请)?(?:帮我)?(?:记住|更正记忆)[：:\s]*|^(?:remember|correct memory):\s*/i, '').trim();
    try {
      const c = classifyStatement(text);
      const entry = addCandidate(p, c, origin, 'explicit', ambiguous(text) || historical(text) || question(text));
      reply = entry.status === 'pending' ? '这条内容已放入待核对列表，暂不用于回复。可在“长期记忆”中更正或确认。'
        : `已保存为跨会话记忆（${labels[entry.kind]}）：${entry.text}\n可以在“长期记忆”中更正、结束或删除。`;
    } catch (error) { if (!(error instanceof MemoryError)) throw error; reply = '这条内容未写入长期记忆：' + error.message + '。'; }
  } else if (command === 'list') {
    const memories = p.entries.filter(e => eligible(e, origin.now));
    const selected = /名字|我叫什么|my name/i.test(input) ? memories.filter(e => e.key === 'profile:name') : memories;
    reply = selected.length ? `当前可用的跨会话记忆（用户陈述）：\n${selected.slice(-20).map(e => `• ${labels[e.kind]}${e.certainty === 'tentative' ? '（考虑中）' : e.certainty === 'inferred' ? '（推测，非定论）' : ''}：${e.text}`).join('\n')}` : '没有对应的有效长期记忆。你可以直接说说近况，或用“记住：……”保存。';
  } else if (p.settings.capture) {
    // Deterministic extraction wins for spans it recognizes; semantic extraction expands coverage.
    const direct = extractStatements(input);
    const candidates = [...direct.map(d => ({ ...d, replaces: inferred.find(c => c.kind === d.kind && c.key === d.key)?.replaces })), ...inferred.filter(c => !direct.some(d => d.kind === c.kind && d.key === c.key))];
    for (const c of candidates.slice(0, 8)) {
      try { addCandidate(p, c, origin, c.extracted ? 'extracted' : 'statement'); }
      catch (error) { if (!(error instanceof MemoryError)) throw error; }
    }
  }
  return { profile: p, reply };
}

const mutationSchema = z.object({
  revision: z.number().int().nonnegative(), action: z.enum(['add', 'edit', 'confirm', 'resolve', 'delete', 'clear', 'settings']),
  id: z.string().uuid().optional(), text: z.string().min(1).max(500).optional(), kind: kindSchema.optional(),
  capture: z.boolean().optional(), recall: z.boolean().optional(),
}).strict();
export function mutateMemory(profile: MemoryProfile, body: unknown, origin: MemoryOrigin): MemoryProfile {
  const parsed = mutationSchema.safeParse(body); if (!parsed.success) throw new MemoryError('记忆操作格式无效。');
  const op = parsed.data;
  if (op.revision !== profile.revision) throw new MemoryError('记忆已更新，请刷新后重试。', 409);
  const p = structuredClone(profile), now = origin.now;
  if (op.action === 'clear') clearMemories(p, now);
  else if (op.action === 'settings') {
    if (op.capture === undefined && op.recall === undefined) throw new MemoryError('缺少设置值。');
    if (op.capture !== undefined) p.settings.capture = op.capture;
    if (op.recall !== undefined && op.recall !== p.settings.recall) { p.settings.recall = op.recall; p.contextEpoch++; }
    audit(p, 'settings', '', now);
  } else if (op.action === 'add') {
    if (!op.text || !op.kind) throw new MemoryError('请填写内容和类别。');
    if (ambiguous(op.text) || historical(op.text) || question(op.text)) throw new MemoryError('请用当前、属于你自己的事实或计划描述记忆。');
    addCandidate(p, classifyStatement(op.text, op.kind), origin, 'confirmed');
  } else {
    const item = p.entries.find(e => e.id === op.id); if (!item) throw new MemoryError('记忆不存在。', 404);
    if (op.action === 'delete') { p.entries = p.entries.filter(e => e.id !== item.id); p.contextEpoch++; audit(p, 'delete', item.id, now); }
    else if (op.action === 'resolve') { item.status = 'resolved'; item.reason = '用户手动结束或撤回'; item.updatedAt = now; p.contextEpoch++; audit(p, 'resolve', item.id, now); }
    else {
      const text = op.action === 'edit' ? op.text : item.text;
      if (!text) throw new MemoryError('请填写更正内容。');
      const reason = rejection(text); if (reason) throw new MemoryError(reason);
      if (ambiguous(text) || historical(text) || question(text)) throw new MemoryError('请先更正为当前的自身情况，避免把过去或他人的情况当作现在。');
      // Redact the replaced payload, including its old evidence, rather than retaining dirty text in an audit log.
      p.entries = p.entries.filter(e => e.id !== item.id); p.contextEpoch++;
      const c = classifyStatement(text, op.kind || item.kind);
      addCandidate(p, { ...c, key: c.kind === item.kind ? item.key : c.key, certain: true, certainty: tentative(text) ? 'tentative' : 'stated' }, origin, 'confirmed');
      audit(p, op.action, item.id, now);
    }
  }
  return p;
}
