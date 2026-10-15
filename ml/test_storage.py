"""Standard-library storage checks, using temporary paths and constructed records only."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

from session_storage import Storage


def seed():
    return {'version': 2,
            'sessions': [{'owner': 'fixture-owner', 'id': 'fixture-session', 'state': {'text': 'constructed before'}}],
            'profiles': [{'owner': 'fixture-owner', 'revision': 1, 'entries': ['constructed memory']}]}


def environment():
    values = {key: os.environ[key] for key in ('PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP') if key in os.environ}
    return values | {'PYTHONIOENCODING': 'utf-8', 'PYTHONUTF8': '1'}


class StorageTests(unittest.TestCase):
    def test_second_writer_is_rejected_until_original_writer_releases_lease(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'sessions.sqlite3'
            store = Storage(path)
            try:
                store.initialize(seed())
                with self.assertRaises(OSError):
                    Storage(path)
            finally:
                store.close()
            reopened = Storage(path)
            try:
                self.assertEqual(reopened.initialize(None), seed())
            finally:
                reopened.close()

    def test_initialized_empty_database_never_reimports_stale_deleted_content(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'sessions.sqlite3'
            store = Storage(path)
            self.assertEqual(store.initialize(None), {'needsSeed': True})
            self.assertEqual(store.initialize(seed()), seed())
            store.commit({'deleted': [['fixture-owner', 'fixture-session']],
                          'profiles': [{'owner': 'fixture-owner', 'revision': 2, 'entries': []}]})
            store.close()
            reopened = Storage(path)
            try:
                actual = reopened.initialize(seed())
                self.assertEqual(actual['sessions'], [])
                self.assertEqual(actual['profiles'], [{'owner': 'fixture-owner', 'revision': 2, 'entries': []}])
                self.assertEqual(reopened.initialize(None), actual)
            finally:
                reopened.close()

    def test_failed_transaction_rolls_back_session_delete_and_profile_together(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Storage(Path(directory) / 'sessions.sqlite3')
            try:
                original = store.initialize(seed())
                store.db.execute("CREATE TRIGGER fail_profile BEFORE INSERT ON profiles BEGIN SELECT RAISE(ABORT, 'constructed rejected value'); END")
                with self.assertRaises(sqlite3.IntegrityError):
                    store.commit({'sessions': [{'owner': 'other-owner', 'id': 'new-session', 'state': {'text': 'constructed after'}}],
                                  'deleted': [['fixture-owner', 'fixture-session']],
                                  'profiles': [{'owner': 'fixture-owner', 'revision': 2, 'entries': []}]})
                self.assertEqual(store.initialize(None), original)
            finally:
                store.close()

    def test_failed_seed_rolls_back_marker_and_all_partially_written_records(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Storage(Path(directory) / 'sessions.sqlite3')
            try:
                invalid = seed()
                invalid['profiles'] = [{'entries': ['synthetic invalid profile']}]
                with self.assertRaises(KeyError):
                    store.initialize(invalid)
                self.assertEqual(store.initialize(None), {'needsSeed': True})
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM sessions').fetchone()[0], 0)
                self.assertEqual(store.initialize(seed()), seed())
            finally:
                store.close()

    def test_committed_transaction_survives_process_exit_without_close_or_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'sessions.sqlite3'
            program = """
import json, os, sys
from session_storage import Storage
store = Storage(sys.argv[1])
store.initialize(json.loads(sys.argv[2]))
store.commit({'deleted': [['fixture-owner', 'fixture-session']], 'profiles': [{'owner': 'fixture-owner', 'revision': 2, 'entries': []}]})
os._exit(0)
"""
            result = subprocess.run([sys.executable, '-c', program, str(path), json.dumps(seed())],
                                    cwd=Path(__file__).parent, env=environment(), capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            reopened = Storage(path)
            try:
                actual = reopened.initialize(None)
                self.assertEqual(actual['sessions'], [])
                self.assertEqual(actual['profiles'][0]['revision'], 2)
                self.assertEqual(actual['profiles'][0]['entries'], [])
            finally:
                reopened.close()

    def test_worker_error_is_generic_and_following_requests_still_succeed(self):
        with tempfile.TemporaryDirectory() as directory:
            secret = 'SYNTHETIC_PAYLOAD_MUST_NOT_APPEAR_IN_ERRORS'
            invalid = {'sessions': [{'owner': 'fixture-owner', 'id': 'fixture-session', 'payload': secret}],
                       'profiles': [{'entries': [secret]}]}
            requests = [{'id': 1, 'operation': 'initialize', 'data': {'version': 2, 'sessions': [], 'profiles': []}},
                        {'id': 2, 'operation': 'commit', 'data': invalid},
                        {'id': 3, 'operation': 'initialize', 'data': None},
                        {'id': 4, 'operation': 'close'}]
            result = subprocess.run([sys.executable, str(Path(__file__).with_name('session_storage.py')),
                                     str(Path(directory) / 'sessions.sqlite3')],
                                    input=''.join(json.dumps(value) + '\n' for value in requests), env=environment(),
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn(secret, result.stdout + result.stderr)
            responses = [json.loads(line) for line in result.stdout.splitlines()]
            self.assertEqual(responses[1], {'id': 2, 'error': 'STORAGE_FAILED'})
            self.assertEqual(responses[2]['result'], {'version': 2, 'sessions': [], 'profiles': []})
            self.assertEqual(responses[3], {'id': 4, 'result': {'closed': True}})

    def test_owner_scoping_and_parameterized_ids_keep_other_records_intact(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Storage(Path(directory) / 'sessions.sqlite3')
            try:
                store.initialize(seed())
                store.commit({'sessions': [{'owner': 'other-owner', 'id': 'fixture-session', 'state': {}}]})
                store.commit({'deleted': [["' OR 1=1 --", 'fixture-session']]})
                self.assertEqual(len(store.initialize(None)['sessions']), 2)
                store.commit({'deleted': [['other-owner', 'fixture-session']]})
                self.assertEqual(store.initialize(None), seed())
            finally:
                store.close()

    def test_corrupt_database_startup_does_not_expose_or_replace_file_and_releases_lease(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'sessions.sqlite3'
            contents = b'SYNTHETIC_CORRUPT_DATABASE_MUST_NOT_BE_LOGGED'
            path.write_bytes(contents)
            result = subprocess.run([sys.executable, str(Path(__file__).with_name('session_storage.py')), str(path)],
                                    env=environment(), capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout + result.stderr, '')
            self.assertEqual(path.read_bytes(), contents)
            with self.assertRaises(sqlite3.DatabaseError):
                Storage(path)
            # Repair only this constructed fixture, then prove the failed constructor freed its lease.
            path.write_bytes(b'')
            repaired = Storage(path)
            try:
                self.assertEqual(repaired.initialize(seed()), seed())
            finally:
                repaired.close()


if __name__ == '__main__':
    unittest.main()
