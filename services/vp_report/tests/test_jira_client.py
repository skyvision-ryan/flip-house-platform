"""Jira 客户端：分页完整性、认证形态、脱敏。

分页这一块是最容易"看起来对"的地方：少取了一页，页面会显示一份**完整而错误**
的进度——比报错更糟。所以取不完必须抛错。
"""

from __future__ import annotations

import envsetup  # noqa: F401
import unittest
from unittest.mock import patch

from app import settings
from app.jira_client import JiraClient, JiraError, JiraIncomplete


def _issue(key: str) -> dict:
    return {"key": key, "fields": {"summary": key}}


class PaginationTest(unittest.TestCase):
    def setUp(self):
        self.client = JiraClient()
        self.client._start_field = "customfield_10015"   # 跳过字段发现

    def _with_pages(self, pages):
        """按顺序返回预置的响应。"""
        seq = list(pages)

        def fake(method, path, **kwargs):
            return seq.pop(0)
        return patch.object(self.client, "_request", side_effect=fake)

    def test_single_page_marked_last(self):
        with self._with_pages([{"issues": [_issue("KAN-1")], "isLast": True}]):
            self.assertEqual(len(self.client.search("project = KAN")), 1)

    def test_follows_the_cursor_across_pages(self):
        pages = [
            {"issues": [_issue("KAN-1")], "nextPageToken": "t1", "isLast": False},
            {"issues": [_issue("KAN-2")], "nextPageToken": "t2", "isLast": False},
            {"issues": [_issue("KAN-3")], "isLast": True},
        ]
        with self._with_pages(pages):
            keys = [i["key"] for i in self.client.search("project = KAN")]
        self.assertEqual(keys, ["KAN-1", "KAN-2", "KAN-3"])

    def test_absent_cursor_and_absent_flag_means_done(self):
        """最后一页通常就是"没有 nextPageToken"，不该误判成不完整。"""
        with self._with_pages([{"issues": [_issue("KAN-1")]}]):
            self.assertEqual(len(self.client.search("project = KAN")), 1)

    def test_more_results_without_a_cursor_is_incomplete_not_complete(self):
        """isLast=false 却没给游标：还有数据但我们拿不到。

        这一条如果放过，页面会显示一份完整而错误的进度。
        """
        pages = [{"issues": [_issue("KAN-1")], "isLast": False}]
        with self._with_pages(pages):
            with self.assertRaises(JiraIncomplete):
                self.client.search("project = KAN")

    def test_truncated_midway_is_incomplete(self):
        pages = [
            {"issues": [_issue("KAN-1")], "nextPageToken": "t1", "isLast": False},
            {"issues": [_issue("KAN-2")], "isLast": False},     # 游标突然没了
        ]
        with self._with_pages(pages):
            with self.assertRaises(JiraIncomplete):
                self.client.search("project = KAN")

    def test_malformed_response_is_an_error_not_an_empty_result(self):
        with self._with_pages([{"nope": 1}]):
            with self.assertRaises(JiraError):
                self.client.search("project = KAN")

    def test_runaway_pagination_stops_and_reports(self):
        pages = [{"issues": [_issue(f"KAN-{i}")], "nextPageToken": f"t{i}", "isLast": False}
                 for i in range(50)]
        with self._with_pages(pages):
            with self.assertRaises(JiraIncomplete):
                self.client.search("project = KAN")


class AuthShapeTest(unittest.TestCase):
    """两种 token 形态都要能拼对，真实用哪种必须靠 verify_auth() 实测。"""

    def test_classic_token_uses_basic_against_the_site(self):
        c = JiraClient(site="https://example.atlassian.net", email="a@b.c",
                       token="tok", auth_mode="basic")
        self.assertEqual(c.base_url, "https://example.atlassian.net")
        self.assertTrue(c._headers()["Authorization"].startswith("Basic "))

    def test_scoped_token_uses_bearer_against_the_gateway(self):
        c = JiraClient(token="tok", auth_mode="bearer", cloud_id="cloud-123")
        self.assertEqual(c.base_url, "https://api.atlassian.com/ex/jira/cloud-123")
        self.assertEqual(c._headers()["Authorization"], "Bearer tok")

    def test_scoped_token_without_cloud_id_is_refused_early(self):
        c = JiraClient(token="tok", auth_mode="bearer", cloud_id="")
        with self.assertRaises(JiraError):
            _ = c.base_url


class RedactionTest(unittest.TestCase):
    def test_credentials_never_appear_in_error_text(self):
        from app.jira_client import _redact
        with patch.object(settings, "JIRA_TOKEN", "super-secret-token"), \
             patch.object(settings, "JIRA_EMAIL", "report-bot@example.com"):
            text = "失败：token=super-secret-token user=report-bot@example.com"
            cleaned = _redact(text)
        self.assertNotIn("super-secret-token", cleaned)
        self.assertNotIn("report-bot@example.com", cleaned)

    def test_start_field_falls_back_when_discovery_fails(self):
        c = JiraClient()
        with patch.object(c, "_request", side_effect=JiraError("字段接口挂了")):
            self.assertEqual(c.start_date_field(), "customfield_10015")

    def test_start_field_matches_localised_display_name(self):
        c = JiraClient()
        fields = [
            {"id": "customfield_10001", "name": "Sprint", "schema": {"custom": "x"}},
            {"id": "customfield_10015", "name": "开始日期", "schema": {
                "custom": "com.atlassian.jira.plugin.system.customfieldtypes:datepicker"}},
        ]
        with patch.object(c, "_request", return_value=fields):
            self.assertEqual(c.start_date_field(), "customfield_10015")


if __name__ == "__main__":
    unittest.main()
