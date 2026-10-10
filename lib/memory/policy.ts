import { MemoryRecord } from './schema';

export function normalize(text: string): string { return text.normalize('NFKC').trim().replace(/\s+/g, ' '); }
export function fingerprint(text: string): string { return normalize(text).toLowerCase().replace(/[\p{P}\p{Z}]/gu, ''); }

/** Defense in depth, not a complete classifier. Rejected payloads never enter memory/audit. */
export function rejection(text: string, maxLength = 500): string | undefined {
  if (!text.trim() || text.length > maxLength) return `记忆内容需为 1–${maxLength} 字符`;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u202a-\u202e\u2066-\u2069]/u.test(text)) return '含有控制字符';
  if (/\bsk-[\w-]{12,}|\bgh[pousr]_[\w]{12,}|github_pat_|PRIVATE KEY|(?:api[_ -]?key|password|密码|密钥|令牌)\s*(?:[:：=]|是|为|is\b)|\beyJ[\w-]{15,}\.[\w-]+\.[\w-]+|\b\d{17}[\dXx]\b|\b1[3-9]\d{9}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text)) return '含有凭据或直接身份标识';
  if (/https?:\/\/|<\/?(?:script|system|assistant|iframe)|<\||```|(?:忽略|覆盖|绕过|无视).{0,12}(?:指令|规则|系统|安全)|(?:系统提示|开发者指令|提示词|越狱)|(?:ignore|override|bypass).{0,35}(?:instruction|system|rule|safety)|system\s*prompt|developer\s*message|你必须|你要始终|以后.{0,8}(?:回复|回答).{0,8}(?:必须|只能)|always (?:reply|respond)|you must/i.test(text)) return '含有指令、代码或外部链接';
  return undefined;
}
export function ambiguous(text: string): boolean {
  return /[“”「」『』"`]|^(?:>|他说|她说|朋友说|我朋友|我的朋友|my friend|he |she |they )|假设|假如|扮演|翻译|例如|举例|虚构|测试文本|(?:hypothetic|role.?play|pretend|translate|fiction|example)/i.test(text);
}
export function tentative(text: string): boolean { return /如果|可能|不确定|还没决定|尚未决定|考虑|打算|想要|计划|或许|要是|也许|\bif\b|maybe|might|perhaps|not sure|considering|haven't decided|have not decided|plan to|want to/i.test(text); }
export function historical(text: string): boolean {
  return /昨天|前天|以前|曾经|去年|上周|上个月|当时|那时候|\b(?:yesterday|last (?:week|month|year)|used to|previously|back then)\b|\b20\d{2}[-/年]\d{1,2}/i.test(text);
}
export function question(text: string): boolean {
  return /[?？]|(?:吗|么|是否|有没有|是不是)|(?:什么|怎么|怎样|为何|哪里|谁)(?:[。.!]|$)|^(?:am I|do I|did I|have I|should I|what|why|how|whether)\b/i.test(text);
}
export function eligible(record: MemoryRecord, now: number): boolean {
  return record.status === 'active' && record.expiresAt > now && !rejection(record.text) && record.evidence.every(e => !rejection(e.quote));
}
