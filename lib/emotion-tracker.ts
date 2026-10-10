/**
 * 情绪轨迹追踪器
 * 记录每轮对话的情绪、强度、效价、唤醒度
 * 计算情绪趋势（declining/stable/escalating）
 * 基于轨迹推荐共情策略
 */

import { MemoryProfile, DAY } from './memory/schema';
import { rejection } from './memory/policy';

export function reportedEmotion(text: string): { name: string; valence: number } | undefined {
  if (/不(?:再|太)?(?:焦虑|难过|害怕)|no longer (?:anxious|sad|afraid)/i.test(text)) return { name: '负面感受减轻', valence: .2 };
  if (/不(?:太)?(?:开心|高兴)|not (?:happy|glad)/i.test(text)) return { name: '低落', valence: -.5 };
  const groups: [RegExp,string,number][] = [[/焦虑|紧张|担忧|担心|压力|anxious|nervous|worried|stressed/i,'焦虑',-.6],
    [/难过|悲伤|孤独|失落|sad|lonely/i,'低落',-.6], [/愤怒|生气|烦躁|angry|frustrated/i,'烦躁',-.6],
    [/开心|高兴|喜悦|happy|joy|glad/i,'喜悦',.65], [/平静|安心|calm|peaceful/i,'平静',.3],
    [/疲惫|很累|tired|exhausted/i,'疲惫',-.3], [/迷茫|困惑|confused/i,'困惑',-.2]];
  const match = groups.find(([pattern]) => pattern.test(text));
  return match ? { name: match[1], valence: match[2] } : undefined;
}
/** Recomputed from evidence on every read, so corrections/deletions cannot leave a hidden derived profile. */
export function memoryEmotionTrend(profile: MemoryProfile, now = Date.now()) {
  const slots = new Map<string, { at:number; session:string; sourceId:string; emotion:string; valence:number; inferred:boolean }>();
  if (profile.settings.recall) for (const e of profile.entries) {
    if (e.kind !== 'emotion' || e.status === 'pending' || e.status === 'resolved' || e.source === 'legacy' || rejection(e.text)) continue;
    const value = reportedEmotion(e.text); if (!value) continue;
    for (const proof of e.evidence) {
      if (proof.at < now - 30 * DAY || proof.at > now || rejection(proof.quote)) continue;
      const key = proof.sessionId + ':' + new Date(proof.at).toISOString().slice(0,10);
      const previous = slots.get(key);
      if (!previous || previous.at <= proof.at) slots.set(key, { at:proof.at, session:proof.sessionId, sourceId:e.id, emotion:value.name, valence:value.valence, inferred:e.certainty !== 'stated' });
    }
  }
  const points = [...slots.values()].sort((a,b) => a.at - b.at).slice(-60);
  const trusted = points.filter(p => !p.inferred), sessions = new Set(trusted.map(p => p.session)).size;
  const days = new Set(trusted.map(p => new Date(p.at).toISOString().slice(0,10))).size;
  const mid = Math.floor(trusted.length / 2), mean = (items: typeof trusted) => items.reduce((n,p) => n + p.valence,0)/Math.max(1,items.length);
  const delta = mean(trusted.slice(mid)) - mean(trusted.slice(0,mid));
  const direction = trusted.length < 3 || sessions < 2 || days < 2 ? 'insufficient' : delta > .25 ? 'more_positive' : delta < -.25 ? 'more_negative' : 'stable';
  return { windowDays:30, direction, sessions, days, observations:points.length, points,
    label: { insufficient:'记录尚不足以判断趋势', more_positive:'近期自述感受较前期积极', more_negative:'近期自述感受较前期低落', stable:'近期自述感受大致平稳' }[direction],
    note:'来自有日期的用户自述；不是诊断，不代表现在的情绪，也不用于覆盖当前原话。' };
}
