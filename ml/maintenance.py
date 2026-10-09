"""Single-worker public-corpus maintenance. No chat/memory input and no arbitrary commands."""
import json, subprocess, sys, threading, time
from datetime import datetime, timezone
from corpus import ROOT, DATA, write_json
from lease import corpus_lease

class Maintenance:
    def __init__(self, run=subprocess.run, start_scheduler=True):
        self.lock=threading.Lock(); self.run=run; self.file=DATA/'reports/maintenance.json'
        self.state={'status':'idle','phase':'idle','scheduleHours':0,'nextRunAt':None}
        if self.file.exists():
            try:
                saved=json.loads(self.file.read_text(encoding='utf-8'))
                self.state.update({k:saved[k] for k in self.state if k in saved})
                if self.state['scheduleHours'] not in (0,24,168): self.state['scheduleHours']=0
                if self.state['status']=='running': self.state.update(status='interrupted',phase='idle')
            except (ValueError,OSError): pass
        if start_scheduler: threading.Thread(target=self.scheduler,daemon=True).start()

    def save(self):
        write_json(self.file.with_suffix('.tmp'),self.state);self.file.with_suffix('.tmp').replace(self.file)
    def snapshot(self):
        with self.lock:return dict(self.state)
    def configure(self,hours):
        if isinstance(hours,bool) or hours not in (0,24,168):raise ValueError('Invalid schedule')
        with self.lock:
            self.state.update(scheduleHours=hours,nextRunAt=time.time()+hours*3600 if hours else None);self.save()
            return dict(self.state)
    def start(self,mode):
        if mode not in ('rebuild','update'):raise ValueError('Invalid operation')
        with self.lock:
            if self.state['status']=='running':return False
            self.state.update(status='running',phase='queued',startedAt=datetime.now(timezone.utc).isoformat(),finishedAt=None);self.save()
        threading.Thread(target=self.work,args=(mode,),daemon=True).start();return True
    def work(self,mode):
        # Prevent another maintenance service instance from writing this corpus concurrently.
        try:
            with corpus_lease(DATA/'reports/corpus-update.lock'):
                steps=[('collect',['ml/corpus.py','--refresh'])] if mode=='update' else []
                steps += [('index',['ml/build_index.py'])]
                with (DATA/'reports/maintenance.log').open('w',encoding='utf-8') as log:
                    for phase,args in steps:
                        with self.lock:self.state['phase']=phase;self.save()
                        self.run([sys.executable,'-u',*args],cwd=str(ROOT),stdout=log,stderr=log,timeout=1800,check=True)
            partial=False
            if mode=='update':
                manifest=json.loads((DATA/'manifests/corpus.json').read_text(encoding='utf-8'))
                partial=bool(manifest.get('failures'))
            with self.lock:self.state.update(status='partial' if partial else 'success',phase='idle')
        except (OSError,ValueError,subprocess.SubprocessError):
            with self.lock:self.state.update(status='failed',phase='idle')
        finally:
            with self.lock:
                self.state['finishedAt']=datetime.now(timezone.utc).isoformat()
                hours=self.state['scheduleHours'];self.state['nextRunAt']=time.time()+hours*3600 if hours else None;self.save()
    def scheduler(self):
        while True:
            time.sleep(30)
            state=self.snapshot()
            if state['scheduleHours'] and state['nextRunAt'] and time.time()>=state['nextRunAt'] and state['status']!='running':self.start('update')
