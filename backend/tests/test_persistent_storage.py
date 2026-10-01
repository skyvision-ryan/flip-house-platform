"""Storage migration guards use isolated synthetic SQLite data only."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import start_persistent
import storage_backup


class PersistentStorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.data = self.root / "disk"
        (self.data / "uploads").mkdir(parents=True)
        self.attachment = self.data / "uploads" / "original.txt"
        self.attachment.write_bytes(b"synthetic-original-attachment")
        self.database = self.data / "app.db"
        with sqlite3.connect(self.database) as db:
            db.executescript("""
              CREATE TABLE users(id INTEGER PRIMARY KEY, password_hash TEXT, role_code TEXT, active INTEGER);
              CREATE TABLE projects(id INTEGER PRIMARY KEY, notes TEXT);
              CREATE TABLE project_members(project_id INTEGER REFERENCES projects, user_id INTEGER REFERENCES users);
              CREATE TABLE files(id INTEGER PRIMARY KEY, stored_path TEXT);
              CREATE TABLE procurement_images(id INTEGER PRIMARY KEY, stored_path TEXT);
              CREATE TABLE task_events(id INTEGER PRIMARY KEY, description TEXT);
              CREATE TABLE purchase_orders(id INTEGER PRIMARY KEY, facts TEXT);
              INSERT INTO users VALUES(1, 'synthetic-unchanged-password-hash', '采购', 1);
              INSERT INTO projects VALUES(1, '员工原始备注');
              INSERT INTO project_members VALUES(1, 1);
              INSERT INTO task_events VALUES(1, '原始历史');
              INSERT INTO purchase_orders VALUES(1, '{"paid":125.50,"received":2,"refunded":12.50}');
            """)
            db.execute("INSERT INTO files VALUES(1, ?)", (str(self.attachment),))
        self.env = {"DATA_DIR": str(self.data), "PERSISTENT_DISK_PATH": str(self.data),
                    "DEMO_MODE": "0", "SEED_DEMO": "0", "COOKIE_SECURE": "1",
                    "SECRET_KEY": "synthetic-stable-session-secret-for-tests"}

    def fingerprint(self):
        return {p.relative_to(self.data).as_posix():hashlib.sha256(p.read_bytes()).hexdigest()
                for p in self.data.rglob("*") if p.is_file()}

    def test_valid_existing_data_is_read_only_and_passwords_unchanged(self):
        before = self.fingerprint()
        with patch.object(start_persistent.os.path, "ismount", return_value=True):
            self.assertEqual(start_persistent.configuration(self.env)["data"], self.data.resolve())
        self.assertEqual(self.fingerprint(), before)

    def test_missing_mount_or_reset_flags_refuse_before_modifying_data(self):
        before = self.fingerprint()
        for overrides in ({"DEMO_MODE":"1"}, {"SEED_DEMO":"1"}, {"TEAM_DEMO_RESET_ID":"reset"},
                          {"SECRET_KEY":"short"}, {"COOKIE_SECURE":"0"},
                          {"DB_URL":"sqlite:////tmp/other.db"}, {"DATA_DIR":str(self.root)}):
            with self.subTest(overrides=overrides), patch.object(start_persistent.os.path,"ismount",return_value=True):
                with self.assertRaises(ValueError):start_persistent.configuration({**self.env, **overrides})
        with patch.object(start_persistent.os.path,"ismount",return_value=False):
            with self.assertRaises(ValueError):start_persistent.configuration(self.env)
        self.assertEqual(self.fingerprint(), before)

    def test_empty_disk_never_creates_database_or_replacement_accounts(self):
        self.database.unlink()
        with patch.object(start_persistent.os.path,"ismount",return_value=True):
            with self.assertRaises(ValueError):start_persistent.configuration(self.env)
        self.assertFalse(self.database.exists())

    def test_missing_original_attachment_blocks_start(self):
        self.attachment.unlink()
        with patch.object(start_persistent.os.path,"ismount",return_value=True):
            with self.assertRaises(ValueError):start_persistent.configuration(self.env)

    def test_backup_includes_committed_wal_and_can_restore_all_tables(self):
        with sqlite3.connect(self.database) as writer:
            writer.execute("PRAGMA journal_mode=WAL")
            writer.execute("INSERT INTO projects VALUES(2, 'committed WAL row')")
            writer.commit()
            bundle = storage_backup.backup(self.data, self.root / "backups")
            self.assertFalse((bundle / "INCOMPLETE").exists())
            restored = self.root / "restored"
            shutil.copytree(bundle, restored)
            with sqlite3.connect(restored / "app.db") as db:
                self.assertEqual(db.execute("PRAGMA integrity_check").fetchone(), ("ok",))
                self.assertEqual(db.execute("SELECT notes FROM projects WHERE id=2").fetchone(), ("committed WAL row",))
                for table in ("users","projects","project_members","files","procurement_images","task_events","purchase_orders"):
                    self.assertEqual(writer.execute(f"SELECT * FROM {table}").fetchall(), db.execute(f"SELECT * FROM {table}").fetchall())
            self.assertEqual((restored / "uploads/original.txt").read_bytes(), self.attachment.read_bytes())
            manifest = json.loads((bundle / "manifest.json").read_text())
            self.assertEqual(manifest["table_counts"]["projects"], 2)
            self.assertNotIn("synthetic-unchanged-password-hash", (bundle / "manifest.json").read_text())

    def test_changed_upload_refuses_to_mark_bundle_complete(self):
        copytree = storage_backup.shutil.copytree
        def changed(src,dst):
            result=copytree(src,dst)
            self.attachment.write_bytes(b"changed-during-copy")
            return result
        with patch.object(storage_backup.shutil,"copytree",side_effect=changed):
            with self.assertRaises(ValueError):storage_backup.backup(self.data,self.root / "backups")
        bundles=list((self.root / "backups").iterdir())
        self.assertEqual(len(bundles),1)
        self.assertTrue((bundles[0] / "INCOMPLETE").exists())
        self.assertFalse((bundles[0] / "manifest.json").exists())

    def test_existing_orphan_records_are_preserved_and_reported(self):
        with sqlite3.connect(self.database) as db:
            db.execute("INSERT INTO project_members VALUES(99, 1)")
        before = self.fingerprint()
        bundle = storage_backup.backup(self.data, self.root / "backups")
        self.assertEqual(self.fingerprint(), before)
        with sqlite3.connect(self.database) as source, sqlite3.connect(bundle / "app.db") as restored:
            self.assertEqual(list(source.iterdump()), list(restored.iterdump()))
            violations = restored.execute("PRAGMA foreign_key_check").fetchall()
            self.assertEqual(violations, source.execute("PRAGMA foreign_key_check").fetchall())
        manifest = json.loads((bundle / "manifest.json").read_text())
        self.assertTrue(manifest["sqlite_integrity_verified"])
        self.assertFalse(manifest["foreign_keys_verified"])
        self.assertEqual(manifest["foreign_key_violations"], [list(row) for row in violations])
        self.assertFalse((bundle / "INCOMPLETE").exists())
        with patch.dict(os.environ,self.env,clear=True), patch.object(start_persistent.os.path,"ismount",return_value=True), patch.object(start_persistent.os,"execv") as run:
            self.assertEqual(start_persistent.main(), 0)
            run.assert_called_once()
        self.assertEqual(hashlib.sha256(self.database.read_bytes()).hexdigest(), before["app.db"])

    def test_corrupt_database_still_refuses_backup(self):
        self.database.write_bytes(b"not a SQLite database")
        with self.assertRaises(sqlite3.DatabaseError):
            storage_backup.backup(self.data, self.root / "backups")
        bundle = next((self.root / "backups").iterdir())
        self.assertTrue((bundle / "INCOMPLETE").exists())
        self.assertFalse((bundle / "manifest.json").exists())

    def test_symlink_uploads_or_nested_backup_rejected(self):
        with self.assertRaises(ValueError):storage_backup.backup(self.data,self.data / "uploads/backup")
        (self.data / "uploads/link").symlink_to(self.attachment)
        with self.assertRaises(ValueError):storage_backup.backup(self.data,self.root / "backups")

    def test_repeated_startup_only_snapshots_never_runs_demo_or_provisions(self):
        before=self.database.read_bytes()
        with patch.dict(os.environ,self.env,clear=True), patch.object(start_persistent.os.path,"ismount",return_value=True), patch.object(start_persistent.os,"execv") as run:
            self.assertEqual(start_persistent.main(),0)
            self.assertEqual(start_persistent.main(),0)
            self.assertEqual(run.call_count,2)
            self.assertEqual(run.call_args.args[1][1:4],["-m","uvicorn","app.main:app"])
        self.assertEqual(self.database.read_bytes(),before)
        self.assertEqual(len(list((self.data / "startup-backups").iterdir())),2)


if __name__ == "__main__":
    unittest.main()
