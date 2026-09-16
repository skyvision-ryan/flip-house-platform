"""服务层：快照状态机、口令访问、响应头。"""

from __future__ import annotations

import envsetup  # noqa: F401
import threading
import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import quote

import jira_fixtures as fx
from fastapi.testclient import TestClient

from app import auth, main, settings, snapshot
from app.store import (
    STATUS_LOADING, STATUS_OK, STATUS_STALE, STATUS_UNAVAILABLE, SnapshotStore,
)


def good_snapshot():
    return snapshot.assemble(
        lane_raw=fx.lanes(), child_raw=fx.children() + fx.subtasks(),
        milestone_raw=fx.milestones(), meeting_raw=fx.meetings(),
        start_field=fx.START_FIELD, today=date(2026, 9, 16),
        fetched_at="2026-09-16T10:00:00-07:00")


class StoreTest(unittest.TestCase):
    def test_starts_in_loading_not_unavailable(self):
        store = SnapshotStore(good_snapshot)
        self.assertEqual(store.status(), STATUS_LOADING)

    def test_successful_fetch_becomes_ok(self):
        store = SnapshotStore(good_snapshot)
        store.refresh_blocking()
        self.assertEqual(store.status(), STATUS_OK)
        self.assertEqual(store.state()["fetched_at"], "2026-09-16T10:00:00-07:00")

    def test_never_succeeded_plus_failure_is_unavailable(self):
        def boom():
            raise RuntimeError("Jira 挂了")
        store = SnapshotStore(boom)
        store.refresh_blocking()
        self.assertEqual(store.status(), STATUS_UNAVAILABLE)
        self.assertIsNone(store.state()["snapshot"])

    def test_failure_after_success_keeps_the_last_good_snapshot(self):
        calls = {"n": 0}

        def flaky():
            calls["n"] += 1
            if calls["n"] == 1:
                return good_snapshot()
            raise RuntimeError("Jira 限流")

        store = SnapshotStore(flaky)
        store.refresh_blocking()
        store.refresh_blocking()
        self.assertEqual(store.status(), STATUS_STALE)
        # 旧数据还在，而且时间戳仍然是那次**成功**同步的时间
        self.assertIsNotNone(store.state()["snapshot"])
        self.assertEqual(store.state()["fetched_at"], "2026-09-16T10:00:00-07:00")
        self.assertIn("Jira 限流", store.state()["last_error"])

    def test_structurally_broken_snapshot_does_not_replace_the_good_one(self):
        calls = {"n": 0}

        def sometimes_broken():
            calls["n"] += 1
            snap = good_snapshot()
            if calls["n"] > 1:
                snap.lines = []          # 结构损坏：空报告
            return snap

        store = SnapshotStore(sometimes_broken)
        store.refresh_blocking()
        store.refresh_blocking()
        self.assertEqual(store.status(), STATUS_STALE)
        self.assertEqual(len(store.state()["snapshot"]["lines"]), 2)

    def test_partial_snapshot_never_overwrites_a_complete_one(self):
        """partial = 某一类记录没取到，页面会整块缺失。拿它盖掉完整数据是倒退。"""
        calls = {"n": 0}

        def degrading():
            calls["n"] += 1
            snap = good_snapshot()
            if calls["n"] > 1:
                snap.fetch_status = "partial"
                snap.fetch_errors = ["里程碑查询失败"]
                snap.milestones = []
            return snap

        store = SnapshotStore(degrading)
        store.refresh_blocking()
        complete = len(store.state()["snapshot"]["milestones"])
        store.refresh_blocking()
        self.assertEqual(store.status(), STATUS_STALE)
        self.assertEqual(len(store.state()["snapshot"]["milestones"]), complete,
                         "partial 快照把完整数据盖掉了")

    def test_partial_on_a_cold_store_stays_unavailable(self):
        def partial():
            snap = good_snapshot()
            snap.fetch_status = "partial"
            snap.fetch_errors = ["会议查询失败"]
            return snap

        store = SnapshotStore(partial)
        store.refresh_blocking()
        self.assertEqual(store.status(), STATUS_UNAVAILABLE)

    def test_schedule_conflicts_do_not_block_the_snapshot(self):
        """排期冲突是业务事实，快照照常替换——这条是第 1 点纠偏的回归测试。"""
        store = SnapshotStore(good_snapshot)
        store.refresh_blocking()
        self.assertEqual(store.status(), STATUS_OK)
        anomalies = store.state()["snapshot"]["date_check"]["anomalies"]
        self.assertTrue(anomalies, "这份 fixture 本来就该有排期冲突")

    def test_concurrent_refreshes_collapse_into_one_upstream_call(self):
        gate = threading.Event()
        calls = {"n": 0}

        def slow():
            calls["n"] += 1
            gate.wait(timeout=5)
            return good_snapshot()

        store = SnapshotStore(slow)
        triggered = [store.ensure_fresh() for _ in range(8)]
        self.assertEqual(sum(1 for t in triggered if t), 1, "并发刷新没有合并")
        gate.set()
        for _ in range(50):
            if store.status() == STATUS_OK:
                break
            threading.Event().wait(0.05)
        self.assertEqual(calls["n"], 1)

    def test_manual_refresh_right_after_a_fetch_is_held_off(self):
        store = SnapshotStore(good_snapshot)
        store.refresh_blocking()
        self.assertFalse(store.ensure_fresh(manual=True))

    def test_manual_refresh_has_a_server_side_cooldown(self):
        store = SnapshotStore(good_snapshot)
        store.refresh_blocking()
        store._last_started -= settings.MANUAL_REFRESH_COOLDOWN + 1   # 冷却已过
        first = store.ensure_fresh(manual=True)
        second = store.ensure_fresh(manual=True)
        self.assertTrue(first)
        self.assertFalse(second, "手动刷新没有冷却，登录用户可以无限打 Jira")

    def test_cache_ttl_prevents_needless_fetches(self):
        calls = {"n": 0}

        def counted():
            calls["n"] += 1
            return good_snapshot()

        store = SnapshotStore(counted)
        store.refresh_blocking()
        self.assertFalse(store.ensure_fresh())      # 还新鲜，不该再取
        self.assertEqual(calls["n"], 1)


class ClientIPTest(unittest.TestCase):
    """限流必须打在真实客户端上，不能把所有微信用户算成一个人。"""

    @staticmethod
    def _req(xff: str | None, peer="10.0.0.9"):
        headers = {"x-forwarded-for": xff} if xff else {}
        return SimpleNamespace(headers=headers, client=SimpleNamespace(host=peer))

    def test_uses_peer_when_no_proxy_is_trusted(self):
        with patch.object(settings, "TRUSTED_PROXY_HOPS", 0):
            self.assertEqual(auth.client_ip(self._req("1.2.3.4")), "10.0.0.9")

    def test_takes_the_hop_the_proxy_appended(self):
        with patch.object(settings, "TRUSTED_PROXY_HOPS", 1):
            self.assertEqual(auth.client_ip(self._req("203.0.113.7")), "203.0.113.7")

    def test_client_supplied_prefix_cannot_spoof_the_ip(self):
        """客户端伪造的 XFF 会被代理挤到左边，取不到。"""
        with patch.object(settings, "TRUSTED_PROXY_HOPS", 1):
            got = auth.client_ip(self._req("9.9.9.9, 203.0.113.7"))
            self.assertEqual(got, "203.0.113.7")

    def test_different_clients_get_different_buckets(self):
        with patch.object(settings, "TRUSTED_PROXY_HOPS", 1):
            a = auth.client_ip(self._req("203.0.113.7"))
            b = auth.client_ip(self._req("203.0.113.8"))
            self.assertNotEqual(a, b)


class AppTest(unittest.TestCase):
    def setUp(self):
        self.store = SnapshotStore(good_snapshot)
        self.store.refresh_blocking()
        self._patch = patch.object(main, "store", self.store)
        self._patch.start()
        main.limiter = auth.AttemptLimiter()
        self.client = TestClient(main.app)

    def tearDown(self):
        self._patch.stop()

    # ---- 健康检查 ----

    def test_healthz_ok_when_configured(self):
        r = self.client.get("/healthz")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["ok"])

    def test_healthz_does_not_name_the_missing_secret(self):
        with patch.object(settings, "REPORT_SECRET", ""):
            r = self.client.get("/healthz")
        self.assertEqual(r.status_code, 503)
        body = r.text
        self.assertNotIn("REPORT_SECRET", body)
        self.assertNotIn("JIRA_TOKEN", body)
        self.assertNotIn("REPORT_PASSCODE", body)

    def test_deep_health_check_requires_login_and_hides_identity(self):
        """部署到 Render 之后没有 shell，这是确认 token 类型配对了的唯一途径。"""
        self.assertEqual(self.client.get("/healthz?deep=1").status_code, 401)

        self.client.post("/login", data={"passcode": "kan40-test"})
        with patch.object(main.JiraClient, "verify_auth", lambda self: "some-bot"):
            r = self.client.get("/healthz?deep=1")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["jira"])
        self.assertNotIn("some-bot", r.text)      # 不回账号名

    def test_deep_health_check_reports_bad_credentials_without_detail(self):
        self.client.post("/login", data={"passcode": "kan40-test"})

        def boom(self):
            raise RuntimeError("Jira 拒绝访问（HTTP 401）")

        with patch.object(main.JiraClient, "verify_auth", boom):
            r = self.client.get("/healthz?deep=1")
        self.assertEqual(r.status_code, 503)
        self.assertFalse(r.json()["jira"])
        self.assertNotIn("401", r.json().get("detail", ""))

    def test_missing_secret_fails_closed_rather_than_using_a_random_key(self):
        with patch.object(settings, "REPORT_SECRET", ""):
            self.assertEqual(self.client.get("/").status_code, 503)
            self.assertEqual(self.client.get("/api/report/data").status_code, 503)

    # ---- 未授权 ----

    def test_anonymous_gets_the_chinese_passcode_page(self):
        r = self.client.get("/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("请输入访问口令", r.text)
        self.assertNotIn("内部上线进度</h1>\n", r.text.replace("<h1>内部上线进度</h1>", ""))

    def test_data_endpoint_is_401_even_with_business_demo_headers(self):
        """DEMO_MODE=1 且带 X-Actor：业务系统的绕过开关对报告服务必须无效。"""
        self.assertEqual(settings_demo_mode(), "1")
        actor = {"X-Actor": quote("负责人")}   # 真实前端就是这样编码的
        for path in ("/api/report/data", "/api/report/status"):
            r = self.client.get(path, headers=actor)
            self.assertEqual(r.status_code, 401, path)
        r = self.client.post("/api/report/refresh", headers=actor)
        self.assertEqual(r.status_code, 401)

    # ---- 口令 ----

    def test_wrong_passcode_is_rejected_then_rate_limited(self):
        for _ in range(settings.MAX_ATTEMPTS):
            r = self.client.post("/login", data={"passcode": "nope"})
            self.assertEqual(r.status_code, 401)
        r = self.client.post("/login", data={"passcode": "nope"})
        self.assertEqual(r.status_code, 429)
        self.assertIn("尝试次数过多", r.text)

    def test_correct_passcode_then_cookie_round_trip(self):
        """第二次请求必须靠 cookie jar 真的带回 cookie，不是只看 Set-Cookie。"""
        r = self.client.post("/login", data={"passcode": "kan40-test"})
        self.assertEqual(r.status_code, 200)          # 跟随 303 到 /
        self.assertIn(auth.COOKIE_NAME, self.client.cookies)

        again = self.client.get("/")                  # 不再提供口令
        self.assertEqual(again.status_code, 200)
        self.assertIn("内部上线进度", again.text)
        self.assertNotIn("请输入访问口令", again.text)

        data = self.client.get("/api/report/data")
        self.assertEqual(data.status_code, 200)
        self.assertEqual(data.json()["status"], STATUS_OK)

    def test_cookie_flags_are_set(self):
        r = self.client.post("/login", data={"passcode": "kan40-test"},
                             follow_redirects=False)
        raw = r.headers["set-cookie"]
        self.assertIn("HttpOnly", raw)
        self.assertIn("SameSite=lax", raw.replace("samesite", "SameSite"))
        self.assertIn("Path=/", raw)

    def test_rotating_the_passcode_revokes_old_sessions_without_changing_the_url(self):
        self.client.post("/login", data={"passcode": "kan40-test"})
        self.assertEqual(self.client.get("/api/report/data").status_code, 200)

        with patch.object(settings, "REPORT_PASSCODE", "kan40-rotated"):
            # 地址没变，但旧会话立刻失效
            self.assertEqual(self.client.get("/api/report/data").status_code, 401)
            self.assertIn("请输入访问口令", self.client.get("/").text)

    def test_session_survives_a_restart_when_the_secret_is_fixed(self):
        token = auth.make_token()
        fresh = TestClient(main.app)
        fresh.cookies.set(auth.COOKIE_NAME, token)
        self.assertEqual(fresh.get("/api/report/data").status_code, 200)

    def test_tampered_cookie_is_rejected(self):
        self.client.cookies.set(auth.COOKIE_NAME, "99999999999.deadbeef")
        self.assertEqual(self.client.get("/api/report/data").status_code, 401)

    # ---- 页面状态 ----

    def test_loading_page_when_there_is_no_snapshot_yet(self):
        gate = threading.Event()

        def slow():
            gate.wait(timeout=5)
            return good_snapshot()

        empty = SnapshotStore(slow)
        with patch.object(main, "store", empty):
            self.client.post("/login", data={"passcode": "kan40-test"})
            r = self.client.get("/")
        gate.set()
        self.assertIn("正在同步 Jira 最新进度", r.text)
        self.assertNotIn("需要关注", r.text)

    def test_unavailable_page_says_it_is_not_zero_progress(self):
        def boom():
            raise RuntimeError("no")
        dead = SnapshotStore(boom)
        dead.refresh_blocking()
        with patch.object(main, "store", dead):
            self.client.post("/login", data={"passcode": "kan40-test"})
            r = self.client.get("/")
        self.assertIn("暂不可用", r.text)
        self.assertIn("不代表进度为零", r.text)

    def test_status_endpoint_reports_the_successful_sync_time(self):
        self.client.post("/login", data={"passcode": "kan40-test"})
        body = self.client.get("/api/report/status").json()
        self.assertEqual(body["status"], STATUS_OK)
        self.assertEqual(body["fetched_at"], "2026-09-16T10:00:00-07:00")

    # ---- 响应头 ----

    def test_security_headers_on_the_report_page(self):
        self.client.post("/login", data={"passcode": "kan40-test"})
        r = self.client.get("/")
        csp = r.headers["content-security-policy"]
        self.assertIn("frame-ancestors 'none'", csp)
        self.assertIn("default-src 'none'", csp)
        self.assertNotIn("unsafe-inline", csp)
        self.assertEqual(r.headers["x-content-type-options"], "nosniff")
        self.assertIn("no-store", r.headers["cache-control"])
        self.assertEqual(r.headers["referrer-policy"], "no-referrer")

    def test_inline_script_and_style_carry_the_csp_nonce(self):
        self.client.post("/login", data={"passcode": "kan40-test"})
        r = self.client.get("/")
        nonce = r.headers["content-security-policy"].split("'nonce-")[1].split("'")[0]
        self.assertIn(f'<style nonce="{nonce}"', r.text)
        self.assertIn(f'<script nonce="{nonce}"', r.text)

    def test_unavailable_page_does_not_reload_on_every_tick(self):
        """以前它一发现 status != loading 就 reload，重载后还是 unavailable，
        于是每 2 秒刷一次。现在脚本比较的是"状态有没有变"。"""
        def boom():
            raise RuntimeError("no")
        dead = SnapshotStore(boom)
        dead.refresh_blocking()
        with patch.object(main, "store", dead):
            self.client.post("/login", data={"passcode": "kan40-test"})
            html = self.client.get("/").text
        self.assertIn('data-status="unavailable"', html)
        self.assertIn("!== seenStatus", html)      # 比状态，不是无条件 reload
        self.assertIn("20000", html)               # 退避到 20 秒

    def test_page_records_status_so_a_stale_banner_can_appear(self):
        """取数失败后 fetched_at 不变、只有 status 变 stale。
        页面必须把 status 也记下来，否则用户永远看不到"更新失败"的横幅。"""
        calls = {"n": 0}

        def flaky():
            calls["n"] += 1
            if calls["n"] == 1:
                return good_snapshot()
            raise RuntimeError("Jira 挂了")

        store = SnapshotStore(flaky)
        store.refresh_blocking()
        with patch.object(main, "store", store):
            self.client.post("/login", data={"passcode": "kan40-test"})
            fresh_html = self.client.get("/").text
            store.refresh_blocking()
            stale_html = self.client.get("/").text
        self.assertIn('data-status="ok"', fresh_html)
        self.assertIn('data-status="stale"', stale_html)
        self.assertIn("更新暂时失败", stale_html)
        # fetched_at 两次一样——所以只比时间的话根本刷不出来
        self.assertIn('data-fetched-at="2026-09-16T10:00:00-07:00"', fresh_html)
        self.assertIn('data-fetched-at="2026-09-16T10:00:00-07:00"', stale_html)

    def test_no_api_docs_are_exposed(self):
        for path in ("/docs", "/redoc", "/openapi.json"):
            self.assertEqual(self.client.get(path).status_code, 404, path)


def settings_demo_mode() -> str:
    import os
    return os.environ.get("DEMO_MODE", "")


if __name__ == "__main__":
    unittest.main()
