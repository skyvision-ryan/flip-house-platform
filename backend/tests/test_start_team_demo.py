"""Isolated subprocess coverage of the optional team-demo startup profile."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
ROSTER = [{"name": name, "email": f"{name.lower()}@example.com", "role": role} for name, role in
          (("Jessie", "J"), ("David", "D"), ("Kody", "项目助理"), ("Tristin", "采购"),
           ("Jeremy", "采购"), ("Zoey", "Permit/设计"), ("Sabrina", "财务"))]
RUNNER = """
import sys
sys.path.insert(0, sys.argv[1])
import start_team_demo as starter
def capture(executable, arguments):
    assert arguments[1:4] == ['-m', 'uvicorn', 'app.main:app']
    assert arguments[-4:] == ['--host', '0.0.0.0', '--port', '10000']
    print('SERVER_EXECUTED')
starter.os.execv = capture
raise SystemExit(starter.main())
"""


class TeamDemoStartupTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="team-startup-test-")
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.data = self.directory / "data"
        self.env = {key: value for key, value in os.environ.items() if key not in {
            "DATA_DIR", "DB_URL", "DEMO_MODE", "SEED_DEMO", "SECRET_KEY", "INITIAL_PASSWORD",
            "ADMIN_USER", "ADMIN_PASSWORD", "TEAM_DEMO_USERS_JSON", "TEAM_DEMO_USERS_FILE",
            "TEAM_DEMO_AS_OF", "PORT", "STORAGE"}}
        self.env.update(DATA_DIR=str(self.data), DEMO_MODE="0", SEED_DEMO="0", SECRET_KEY="synthetic-stable-session-key-for-startup-test",
                        INITIAL_PASSWORD="synthetic-employee-passphrase", ADMIN_USER="synthetic-admin",
                        ADMIN_PASSWORD="synthetic-admin-passphrase", TEAM_DEMO_USERS_JSON=json.dumps(ROSTER),
                        TEAM_DEMO_AS_OF="2026-09-25", PROVIDER="mock")

    def run_start(self, env=None, runner=RUNNER):
        result = subprocess.run([sys.executable, "-c", runner, str(ROOT / "scripts")], env=self.env if env is None else env,
                                cwd=ROOT, capture_output=True, text=True, timeout=60)
        for value in [self.env["INITIAL_PASSWORD"], self.env["ADMIN_PASSWORD"], self.env["SECRET_KEY"], *(row["email"] for row in ROSTER)]:
            self.assertNotIn(value, result.stdout + result.stderr)
        return result

    def sql(self, statement, parameters=()):
        with sqlite3.connect(self.data / "app.db") as database:
            return database.execute(statement, parameters).fetchall()

    def test_missing_environment_fails_before_database_or_server(self):
        for key in ("DATA_DIR", "DEMO_MODE", "SEED_DEMO", "SECRET_KEY", "INITIAL_PASSWORD", "ADMIN_USER", "TEAM_DEMO_USERS_JSON"):
            with self.subTest(key=key):
                env = self.env.copy(); del env[key]
                result = self.run_start(env)
                self.assertEqual(result.returncode, 1)
                self.assertNotIn("SERVER_EXECUTED", result.stdout)
                self.assertFalse(self.data.exists())

    def test_unsafe_environment_and_invalid_json_fail_before_database(self):
        for overrides in ({"DEMO_MODE": "1"}, {"SEED_DEMO": "1"}, {"DATA_DIR": "relative-data"},
                          {"SECRET_KEY": "short"}, {"DB_URL": "sqlite:////unrelated-database.db"},
                          {"TEAM_DEMO_USERS_JSON": "invalid private content"}, {"STORAGE": "s3"},
                          {"TEAM_DEMO_USERS_FILE": "also-selected.json"}, {"TEAM_DEMO_AS_OF": "invalid"}):
            with self.subTest(keys=list(overrides)):
                result = self.run_start({**self.env, **overrides})
                self.assertEqual(result.returncode, 1)
                self.assertFalse(self.data.exists())

    def test_empty_database_requires_admin_password_without_creating_users(self):
        env = self.env.copy(); del env["ADMIN_PASSWORD"]
        self.assertEqual(self.run_start(env).returncode, 1)
        self.assertEqual(self.sql("SELECT count(*) FROM users"), [(0,)])

    def test_bootstrap_restart_preserves_accounts_projects_and_operations(self):
        first = self.run_start()
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertIn("SERVER_EXECUTED", first.stdout)
        self.assertEqual(self.sql("SELECT count(*) FROM projects"), [(3,)])
        self.assertEqual(self.sql("SELECT count(*) FROM users"), [(8,)])
        self.sql("UPDATE users SET display_name='Retained name', password_hash='retained-hash' WHERE email=?", (ROSTER[0]["email"],))
        self.sql("UPDATE projects SET notes='Retained team change' WHERE id=(SELECT min(id) FROM projects)")
        self.sql("UPDATE tasks SET description='Retained task change' WHERE id=(SELECT min(id) FROM tasks)")
        before_users = self.sql("SELECT * FROM users ORDER BY id")
        before_projects = self.sql("SELECT * FROM projects ORDER BY id")
        before_tasks = self.sql("SELECT * FROM tasks ORDER BY id")
        env = {**self.env, "INITIAL_PASSWORD": "different-synthetic-password", "ADMIN_PASSWORD": "different-admin-password"}
        second = self.run_start(env)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(before_users, self.sql("SELECT * FROM users ORDER BY id"))
        self.assertEqual(before_projects, self.sql("SELECT * FROM projects ORDER BY id"))
        self.assertEqual(before_tasks, self.sql("SELECT * FROM tasks ORDER BY id"))
        self.assertEqual(len(list((self.data / "team-demo-backups").iterdir())), 1)

    def test_old_projects_refuse_start_without_changing_users(self):
        self.assertEqual(self.run_start().returncode, 0)
        self.sql("UPDATE properties SET apn='legacy-project' WHERE id=(SELECT min(id) FROM properties)")
        before = self.sql("SELECT * FROM users ORDER BY id")
        result = self.run_start()
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("SERVER_EXECUTED", result.stdout)
        self.assertEqual(before, self.sql("SELECT * FROM users ORDER BY id"))
        self.assertEqual(self.sql("SELECT count(*) FROM projects"), [(3,)])

    def test_existing_wrong_role_is_retained_and_prevents_start(self):
        self.assertEqual(self.run_start().returncode, 0)
        self.sql("UPDATE users SET role_code='D' WHERE email=?", (ROSTER[2]["email"],))
        before = self.sql("SELECT * FROM users ORDER BY id")
        self.assertEqual(self.run_start().returncode, 1)
        self.assertEqual(before, self.sql("SELECT * FROM users ORDER BY id"))

    def test_private_file_input(self):
        roster_file = self.directory / "users.local.json"
        roster_file.write_text(json.dumps(ROSTER), encoding="utf-8")
        env = self.env.copy(); del env["TEAM_DEMO_USERS_JSON"]
        env["TEAM_DEMO_USERS_FILE"] = str(roster_file)
        first = self.run_start(env)
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(self.sql("SELECT count(*) FROM users"), [(8,)])

    def test_generator_failure_stops_server_and_retry_reuses_created_accounts(self):
        failing_runner = RUNNER.replace("starter.os.execv = capture", """
import prepare_team_demo
def fail_generation(*args, **kwargs):
    import os
    raise RuntimeError(os.environ['TEAM_DEMO_USERS_JSON'] + os.environ['INITIAL_PASSWORD'])
prepare_team_demo.prepare_demo = fail_generation
starter.os.execv = capture
""")
        result = self.run_start(runner=failing_runner)
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("SERVER_EXECUTED", result.stdout)
        before = self.sql("SELECT * FROM users ORDER BY id")
        self.assertEqual(len(before), 8)
        self.assertEqual(self.sql("SELECT count(*) FROM projects"), [(0,)])
        self.assertEqual(self.run_start().returncode, 0)
        self.assertEqual(before, self.sql("SELECT * FROM users ORDER BY id"))
        self.assertEqual(self.sql("SELECT count(*) FROM projects"), [(3,)])

    def test_existing_project_missing_identity_refuses_replacement(self):
        self.assertEqual(self.run_start().returncode, 0)
        # Changing a roster login simulates a missing identity without deleting
        # the original account or any project-member/task foreign keys.
        roster = [{**row, "email": "replacement@example.com"} if row["name"] == "Kody" else row for row in ROSTER]
        before = self.sql("SELECT * FROM users ORDER BY id")
        result = self.run_start({**self.env, "TEAM_DEMO_USERS_JSON": json.dumps(roster)})
        self.assertEqual(result.returncode, 1)
        self.assertEqual(before, self.sql("SELECT * FROM users ORDER BY id"))


if __name__ == "__main__":
    unittest.main()
