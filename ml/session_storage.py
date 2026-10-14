"""Private, stdlib-only SQLite persistence worker (JSON lines over parent pipes).

No HTTP listener, cloud credentials, corpus access, or dialogue logging. The Node
boundary validates domain schemas; this process owns atomic durable transactions.
"""
import json
import os
import sqlite3
import sys
from pathlib import Path
from lease import corpus_lease as storage_lease


class Storage:
    def __init__(self, path):
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        self.lease = storage_lease(Path(str(target) + '.lock'))
        self.lease.__enter__()
        try:
            self._open(target)
        except Exception:
            if hasattr(self, 'db'):
                self.db.close()
            self.lease.__exit__(*sys.exc_info())
            raise

    def _open(self, target):
        self.db = sqlite3.connect(target, timeout=10)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("PRAGMA secure_delete=ON")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions (
                owner TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
                PRIMARY KEY (owner, id));
            CREATE TABLE IF NOT EXISTS profiles (owner TEXT PRIMARY KEY, payload TEXT NOT NULL);
        """)
        try:
            os.chmod(target, 0o600)
        except OSError:
            pass

    @staticmethod
    def encode(value):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)

    def _apply(self, delta):
        for entry in delta.get("sessions", []):
            self.db.execute("INSERT OR REPLACE INTO sessions VALUES (?, ?, ?)",
                            (entry["owner"], entry["id"], self.encode(entry)))
        for owner, ident in delta.get("deleted", []):
            self.db.execute("DELETE FROM sessions WHERE owner=? AND id=?", (owner, ident))
        for profile in delta.get("profiles", []):
            self.db.execute("INSERT OR REPLACE INTO profiles VALUES (?, ?)",
                            (profile["owner"], self.encode(profile)))

    def initialize(self, seed):
        version = self.db.execute("SELECT value FROM metadata WHERE key='version'").fetchone()
        if version is None:
            if seed is None:
                return {"needsSeed": True}
            if seed.get("version") != 2:
                raise ValueError("Unsupported seed")
            with self.db:
                self._apply(seed)
                self.db.execute("INSERT INTO metadata VALUES ('version', '2')")
        elif version[0] != "2":
            raise ValueError("Unsupported storage version")
        # An initialized database is the sole source, even when deliberately empty.
        return {"version": 2,
                "sessions": [json.loads(r[0]) for r in self.db.execute("SELECT payload FROM sessions")],
                "profiles": [json.loads(r[0]) for r in self.db.execute("SELECT payload FROM profiles")]}

    def commit(self, delta):
        with self.db:
            self._apply(delta)
        return {"committed": True}

    def close(self):
        try:
            self.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        finally:
            self.db.close()
            self.lease.__exit__(None, None, None)


def main():
    storage = None
    try:
        storage = Storage(sys.argv[1])
        for line in sys.stdin:
            request = {}
            try:
                request = json.loads(line)
                operation = request["operation"]
                if operation == "initialize":
                    result = storage.initialize(request["data"])
                elif operation == "commit":
                    result = storage.commit(request["data"])
                elif operation == "close":
                    storage.close()
                    storage = None
                    print(json.dumps({"id": request["id"], "result": {"closed": True}}), flush=True)
                    break
                else:
                    raise ValueError("Unknown operation")
                print(json.dumps({"id": request["id"], "result": result}, ensure_ascii=False), flush=True)
            except Exception:
                # Never serialize exception messages: they may contain personal values.
                print(json.dumps({"id": request.get("id"), "error": "STORAGE_FAILED"}), flush=True)
    except Exception:
        sys.exit(1)
    finally:
        if storage is not None:
            storage.close()


if __name__ == "__main__":
    main()
