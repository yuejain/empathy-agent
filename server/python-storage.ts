import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve } from 'node:path';

/** Persistent local pipe; only explicit storage payloads cross this boundary. */
export class PythonStorage {
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private nextId = 0;
  private failed = false;
  private closing = false;
  private closed?: Promise<void>;
  private fragments: string[] = [];
  private bufferedSize = 0;
  constructor(file: string, executable: string) {
    const environment: NodeJS.ProcessEnv = { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
    for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LOCALAPPDATA']) {
      if (process.env[key]) environment[key] = process.env[key];
    }
    this.child = spawn(executable, ['-u', resolve(__dirname, '../../ml/session_storage.py'), file],
      { env: environment, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      const parts = chunk.split('\n');
      for (let i = 0; i < parts.length; i++) {
        this.fragments.push(parts[i]); this.bufferedSize += parts[i].length;
        if (this.bufferedSize > 128 * 1024 * 1024) { this.fail(); return; }
        if (i === parts.length - 1) break;
        const line = this.fragments.join(''); this.fragments = []; this.bufferedSize = 0;
        try {
          const message = JSON.parse(line), request = this.pending.get(message.id);
          if (!request) { this.fail(); return; }
          this.pending.delete(message.id); clearTimeout(request.timer);
          if (message.error) request.reject(new Error('本地 SQLite 事务失败，未确认保存。'));
          else request.resolve(message.result);
        } catch { this.fail(); return; }
      }
    });
    this.child.stderr.resume(); // Do not forward potentially private interpreter diagnostics.
    this.child.on('error', () => this.fail());
    this.child.on('exit', () => { if (!this.closing || this.pending.size) this.fail(); });
    this.child.stdin.on('error', () => this.fail());
  }
  private fail() {
    this.failed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Python 存储进程不可用，请重启服务并检查配置。')); }
    this.pending.clear(); this.child.kill();
    this.fragments = []; this.bufferedSize = 0;
  }
  request(operation: string, data?: unknown): Promise<any> {
    if (this.failed || this.closing && operation !== 'close') return Promise.reject(new Error('Python 存储进程不可用。'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(), 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, operation, data }) + '\n', error => { if (error) this.fail(); });
    });
  }
  close(): Promise<void> {
    if (this.closed) return this.closed;
    this.closing = true;
    this.closed = (async () => {
      if (!this.failed) await this.request('close');
      this.child.stdin.end();
    })();
    return this.closed;
  }
}
