// Inspect the exact Git index that will be committed, never print matched values.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const git = args => execFileSync('git', args, {cwd:root, maxBuffer:20*1024*1024});
const files = git(['ls-files','--cached','-z']).toString('utf8').split('\0').filter(Boolean);
const localSecrets = [];
for (const file of fs.readdirSync(root).filter(name => /^\.env(?:\..+)?$/.test(name) && name!=='.env.example')) {
  if (!fs.statSync(path.join(root,file)).isFile()) continue;
  for (const line of fs.readFileSync(path.join(root,file),'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?((?:[A-Z0-9]+_)*(?:KEY|TOKEN|SECRET|PASSWORD)(?:_\d+)?)\s*=\s*(.*?)\s*$/i);
    if (!match) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    if (value.length>=8) localSecrets.push(value);
  }
}
const patterns = [
  ['API token', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ['cloud access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ['credential URL', /https?:\/\/[^\s/@:]+:[^\s/@]{12,}@/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/],
];
const problems = [];
for (const file of files) {
  const name = path.posix.basename(file);
  if ((/^\.env(?:\..+)?$/.test(name) && name!=='.env.example') ||
      /^(?:\.npmrc|\.pypirc|credentials.*\.json|service-account.*\.json|id_rsa|id_ed25519)$/.test(name) ||
      /\.(?:pem|key|p12|pfx)$/i.test(name) ||
      /^(?:\.data\/|artifacts\/|models\/local\/|data\/(?:raw|processed|training|index|reports|manifests|cache)\/)/.test(file)) {
    problems.push({file,reason:'local-only file tracked'}); continue;
  }
  const bytes = git(['show',':'+file]);
  if (bytes.length>2*1024*1024) { problems.push({file,reason:'large file requires review'}); continue; }
  const content = bytes.toString('utf8');
  if (localSecrets.some(secret=>content.includes(secret))) problems.push({file,reason:'matches a local credential'});
  for (const [reason,pattern] of patterns) if (pattern.test(content)) problems.push({file,reason});
}
console.log(JSON.stringify({indexedFiles:files.length,findings:problems},null,2));
if (problems.length) process.exitCode=1;
