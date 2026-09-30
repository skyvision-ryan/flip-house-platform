"""Isolated password lifecycle, legacy sessions and unchanged account/project data."""
import time
import unittest
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from app import db, models
from app.auth import COOKIE_NAME, _sign, hash_password, verify_password
from app.routers import auth

OLD = 'synthetic-old-passphrase'
NEW = 'synthetic-new-passphrase'

class PasswordChangeTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        self.addCleanup(self.engine.dispose)
        db.Base.metadata.create_all(self.engine)
        with Session(self.engine) as s:
            for name, role, admin in [('employee', '采购', False), ('admin', '负责人', True), ('design', 'Permit/设计', False)]:
                s.add(models.User(username=name, display_name=name, role_code=role, is_admin=admin, password_hash=hash_password(OLD)))
            s.commit()
        app = FastAPI(); app.include_router(auth.router)
        def override():
            with Session(self.engine) as s: yield s
        app.dependency_overrides[db.get_db] = override
        self.app = app
        self.client = TestClient(app); self.addCleanup(self.client.close)
        self.secure = patch('app.auth.COOKIE_SECURE', False); self.secure.start(); self.addCleanup(self.secure.stop)

    def login(self, name='employee', password=OLD, client=None):
        return (client or self.client).post('/api/auth/login', json={'username': name, 'password': password})

    def change(self, **changes):
        return self.client.post('/api/auth/password', json={'current_password': OLD, 'new_password': NEW, 'confirm_password': NEW, **changes})

    def test_self_change_rotates_sessions_preserves_identity_and_survives_new_client(self):
        before = self.login().json()
        old_cookie = self.client.cookies.get(COOKIE_NAME)
        self.assertEqual(self.change().status_code, 200)
        self.assertEqual(self.client.get('/api/auth/me').json(), before)
        with TestClient(self.app) as other:
            other.cookies.set(COOKIE_NAME, old_cookie)
            self.assertEqual(other.get('/api/auth/me').status_code, 401)
            self.assertEqual(self.login(password=OLD, client=other).status_code, 401)
            self.assertEqual(self.login(password=NEW, client=other).status_code, 200)
        with Session(self.engine) as s:
            u=s.get(models.User, 1)
            self.assertEqual(u.session_version, 1)
            self.assertNotIn(NEW, u.password_hash)
            self.assertTrue(verify_password(NEW, u.password_hash))

    def test_rejects_bad_inputs_without_changes(self):
        self.login()
        with Session(self.engine) as s: original=s.get(models.User, 1).password_hash
        for data in [{'current_password':'wrong'}, {'new_password':'short'}, {'confirm_password':'different'}, {'new_password':OLD,'confirm_password':OLD}, {'new_password':'a'*257}]:
            self.assertEqual(self.change(**data).status_code, 400)
        with Session(self.engine) as s:
            self.assertEqual(s.get(models.User,1).password_hash, original)
            self.assertEqual(s.get(models.User,1).session_version,0)

    def test_permissions_and_session_identity_guard(self):
        self.assertEqual(self.change().status_code,401)
        self.login()
        self.assertEqual(self.client.patch('/api/users/2',json={'password':NEW}).status_code,403)
        response=self.client.post('/api/auth/password',headers={'X-Session-User':'2','X-Actor':'%E8%B4%9F%E8%B4%A3%E4%BA%BA'},json={'current_password':OLD,'new_password':NEW,'confirm_password':NEW})
        self.assertEqual(response.status_code,409)
        self.assertEqual(self.change(user_id=2, is_admin=True).status_code,200)
        with Session(self.engine) as s:
            self.assertTrue(verify_password(OLD,s.get(models.User,2).password_hash))
            self.assertFalse(s.get(models.User,1).is_admin)

    def test_admin_reset_revoke_target_and_preserve_admin(self):
        self.login(); old_cookie=self.client.cookies.get(COOKIE_NAME)
        self.login('admin')
        response=self.client.patch('/api/users/1',json={'password':NEW})
        self.assertEqual(response.status_code,200)
        self.assertNotIn('password_hash',response.json())
        self.assertEqual(self.client.get('/api/users').status_code,200)
        self.client.cookies.set(COOKIE_NAME,old_cookie,domain='testserver.local',path='/')
        self.assertEqual(self.client.get('/api/auth/me').status_code,401)
        self.assertEqual(self.login(password=NEW).status_code,200)

    def test_admin_reset_self_refreshes_current_session(self):
        self.login('admin')
        self.assertEqual(self.client.patch('/api/users/2',json={'password':NEW}).status_code,200)
        self.assertEqual(self.client.get('/api/users').status_code,200)

    def test_legacy_cookie_works_until_password_changes(self):
        payload=f'1.{int(time.time())+3600}'
        legacy=f'{payload}.{_sign(payload)}'
        self.client.cookies.set(COOKIE_NAME,legacy,domain='testserver.local',path='/')
        with self.engine.begin() as conn: conn.execute(text('UPDATE users SET session_version=NULL WHERE id=1'))
        self.assertEqual(self.client.get('/api/auth/me').status_code,200)
        self.assertEqual(self.change().status_code,200)
        self.client.cookies.set(COOKIE_NAME,legacy,domain='testserver.local',path='/')
        self.assertEqual(self.client.get('/api/auth/me').status_code,401)

    def test_all_roles_can_change_own_password(self):
        for name in ['employee','admin','design']:
            self.assertEqual(self.login(name).status_code,200)
            self.assertEqual(self.change().status_code,200)

    def test_legacy_schema_upgrade_preserves_hash_and_existing_rows(self):
        with self.engine.begin() as conn:
            before=conn.execute(text('SELECT id, username, password_hash, role_code, is_admin FROM users')).all()
            conn.execute(text('ALTER TABLE users DROP COLUMN session_version'))
        with patch.object(db,'engine',self.engine): db._ensure_columns()
        with self.engine.connect() as conn:
            self.assertEqual(conn.execute(text('SELECT id, username, password_hash, role_code, is_admin FROM users')).all(),before)
            self.assertEqual(conn.execute(text('SELECT session_version FROM users')).all(),[(None,)]*3)
