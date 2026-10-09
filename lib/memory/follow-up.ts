import { MemoryRecord } from './schema';
import { ambiguous, eligible, fingerprint, question, rejection, tentative } from './policy';

export type Progress = 'planned' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
export const progressLabels: Record<Progress, string> = { planned: '考虑 / 计划中', in_progress: '进行中', blocked: '遇到阻碍', completed: '已完成', cancelled: '已撤回' };
export function progressFrom(text: string, kind: string): Progress {
  if (/还没|尚未|没有|未完成|not yet|haven't|have not/i.test(text)) return /卡住|困难|不下去|stuck|blocked/i.test(text) ? 'blocked' : 'in_progress';
  if (/取消|撤回|放弃|不再|停止|cancel|withdr|stopped|gave up|no longer/i.test(text)) return 'cancelled';
  if (/完成|做完|结束|finished|completed|\bdone\b/i.test(text)) return 'completed';
  if (/卡住|遇到.{0,8}(困难|阻碍)|做不下去|stuck|blocked/i.test(text)) return 'blocked';
  return tentative(text) || kind === 'decision' && !/决定|decided|chosen/i.test(text) ? 'planned' : 'in_progress';
}
export function taskRecord(e: MemoryRecord) { return e.kind === 'activity' || e.kind === 'decision'; }
export function isFollowUpReference(input:string) {
  return /^(?:这件事|那个|这项|它|that\b|it\b|the task)/i.test(input) || /^(?:我(?:已经)?(?:完成了?|做完了?|结束了?)|I(?: have)? (?:finished|completed))[。.!]?$/i.test(input.trim());
}
export function focusedTask(input:string, entries:MemoryRecord[]) {
  const tasks=entries.filter(e => taskRecord(e) && eligible(e,Date.now()));
  const matched=tasks.filter(e => { const key=taskTopic(e);return key.length>=2 && fingerprint(input).includes(key); });
  return matched.length===1 ? matched[0].id : tasks.length===1 ? tasks[0].id : undefined;
}
export function followUpView(entries: MemoryRecord[], now = Date.now()) {
  return entries.filter(e => taskRecord(e) && (eligible(e, now) || e.status === 'resolved' && e.expiresAt > now) && !rejection(e.text) && e.evidence.every(p => !rejection(p.quote)))
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12).map(e => ({ id: e.id, text: e.text, certainty: e.certainty,
      progress: e.progress || progressFrom(e.text, e.kind), label: progressLabels[e.progress || progressFrom(e.text, e.kind)],
      updatedAt: e.updatedAt, dueAt: e.dueAt, lastUpdate: e.evidence.at(-1)?.quote }));
}
function topic(text: string) {
  return fingerprint(text.replace(/^(?:我|I\b)(?:已经|现在|目前|have|am|\s)*/i, '')
    .replace(/(?:决定|正在|完成了?|写|准备|做|计划|的决定|的项目|项目|了|decided to|working on|completed|finished|plan to)/gi, ''));
}
function taskTopic(e:MemoryRecord) { return topic(e.key.replace(/^(?:activity|decision):/,'')); }
/** Link only an explicit status report, never an assistant suggestion or similarity alone. */
export function findFollowUp(input: string, entries: MemoryRecord[], focusId?: string): MemoryRecord | undefined {
  if (ambiguous(input) || question(input) || rejection(input) || tentative(input) || /如果|\bif\b/i.test(input)) return;
  if (!/完成|做完|结束|取消|撤回|放弃|卡住|遇到.{0,8}(困难|阻碍)|继续做|开始做|finished|completed|\bdone\b|cancel|stuck|blocked|resum/i.test(input)) return;
  const tasks = entries.filter(e => taskRecord(e) && eligible(e, Date.now()));
  const key = topic(input);
  const matches = tasks.filter(e => {
    const subject = taskTopic(e);
    return subject.length >= 2 && key.length >= 2 && (key.includes(subject) || subject.includes(key));
  });
  if (matches.length === 1) return matches[0];
  if (!matches.length && isFollowUpReference(input.trim())) {
    return tasks.find(e => e.id === focusId) || (tasks.length === 1 ? tasks[0] : undefined);
  }
}
