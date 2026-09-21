#!/usr/bin/env python3
"""scripts/jira_merge_decision.py 的规则测试。全部离线，不碰 Jira / GitHub / 网络。"""

from __future__ import annotations

import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import jira_merge_decision as jmd  # noqa: E402


class TicketOfTest(unittest.TestCase):
    def test_branch_wins_over_title(self):
        # 分支名是 hook 认的唯一权威，标题写错了也以分支为准
        self.assertEqual(jmd.ticket_of("KAN-49-ui-audit", "KAN-45 改别的"), "KAN-49")

    def test_falls_back_to_title(self):
        self.assertEqual(jmd.ticket_of("codex/jev", "KAN-40 手机进度报告"), "KAN-40")

    def test_none_when_nowhere(self):
        self.assertIsNone(jmd.ticket_of("tidy/asana-cleanup-0921", "整理：清理 Asana 遗留"))
        self.assertIsNone(jmd.ticket_of(None, ""))


class UnverifiedTest(unittest.TestCase):
    def test_finds_the_common_spellings(self):
        self.assertEqual(jmd.unverified_markers("| 真机 | 未验证 | 见第 7 节 |"), ["未验证"])
        self.assertEqual(jmd.unverified_markers("| iPhone | ❌ | 没跑 |"), ["❌"])

    def test_clean_body_has_none(self):
        body = "## 验收\n| 标准 | 结果 | 证据 |\n|---|---|---|\n| 构建 | ✅ | npm run build |"
        self.assertEqual(jmd.unverified_markers(body), [])

    def test_code_blocks_do_not_count(self):
        """PR 正文里贴的命令输出不算作者在声明未验证项。"""
        body = (
            "## 验收\n| 构建 | ✅ | 见下 |\n\n"
            "```\n某个工具打印了「未验证」这三个字\n```\n"
        )
        self.assertEqual(jmd.unverified_markers(body), [])

    def test_empty_body(self):
        self.assertEqual(jmd.unverified_markers(None), [])
        self.assertEqual(jmd.unverified_markers(""), [])


class DecideTest(unittest.TestCase):
    CLEAN = "## 验收\n| 标准 | 结果 | 证据 |\n| 五步 | ✅ | check_local |"
    DIRTY = CLEAN + "\n| 真机 | 未验证 | 不在本票范围 |"

    def test_clean_pr_goes_done(self):
        d = jmd.decide(self.CLEAN, "审查中")
        self.assertEqual(d["action"], "transition")
        self.assertEqual(d["target"], jmd.STATUS_DONE)

    def test_unverified_stops_at_review(self):
        d = jmd.decide(self.DIRTY, "正在进行")
        self.assertEqual(d["target"], jmd.STATUS_REVIEW)
        self.assertEqual(d["markers"], ["未验证"])
        self.assertIn("未验证", d["reason"])

    def test_already_done_is_left_alone(self):
        """幂等：重复触发、或人已经先标了完成，都不再动。"""
        d = jmd.decide(self.CLEAN, "已完成")
        self.assertEqual(d["action"], "skip")
        self.assertIsNone(d["target"])

    def test_done_wins_even_with_unverified(self):
        # 人明确标了完成，流水线不把它拽回审查中
        d = jmd.decide(self.DIRTY, "已完成")
        self.assertEqual(d["action"], "skip")

    def test_unknown_status_still_decides(self):
        d = jmd.decide(self.CLEAN, None)
        self.assertEqual(d["target"], jmd.STATUS_DONE)

    def test_kan49_shaped_body_stops_at_review(self):
        """用 KAN-49 真实 PR 的形状验一遍：它确实有真机未验证项。"""
        body = (
            "## 验收\n"
            "| 非状态色降到 0–2 种 | ✅ | 改前 5 → 改后 0 |\n"
            "| check_local 五步全绿 | ✅ | 四个测试文件 49 项 |\n"
            "| iOS Safari 字体解析 | ⚠️ 未验证 | 真机不在本票范围 |\n"
        )
        self.assertEqual(jmd.decide(body, "正在进行")["target"], jmd.STATUS_REVIEW)


class PickTransitionTest(unittest.TestCase):
    TRANSITIONS = [
        {"id": "11", "to": {"name": "待办"}},
        {"id": "21", "to": {"name": "正在进行"}},
        {"id": "31", "to": {"name": "审查中"}},
        {"id": "41", "to": {"name": "已完成"}},
    ]

    def test_picks_by_status_name_not_hardcoded_id(self):
        self.assertEqual(jmd.pick_transition(self.TRANSITIONS, "已完成"), "41")
        self.assertEqual(jmd.pick_transition(self.TRANSITIONS, "审查中"), "31")

    def test_missing_target_returns_none(self):
        """转换不存在要能报出来，而不是安静地转到别的状态去。"""
        self.assertIsNone(jmd.pick_transition(self.TRANSITIONS, "已归档"))
        self.assertIsNone(jmd.pick_transition([], "已完成"))

    def test_survives_malformed_entries(self):
        self.assertIsNone(jmd.pick_transition([{"id": "9"}], "已完成"))


class CommentAdfTest(unittest.TestCase):
    def test_newlines_become_paragraphs(self):
        """ADF 不认 \\n，换行必须拆成多个段落，否则评论会挤成一坨。"""
        doc = jmd.comment_adf("第一行\n\n第三行")
        content = doc["body"]["content"]
        self.assertEqual(len(content), 3)
        self.assertEqual(content[0]["content"][0]["text"], "第一行")
        self.assertEqual(content[1]["content"], [], "空行是空段落")
        self.assertEqual(content[2]["content"][0]["text"], "第三行")

    def test_shape_is_valid_adf(self):
        doc = jmd.comment_adf("一行")
        self.assertEqual(doc["body"]["type"], "doc")
        self.assertEqual(doc["body"]["version"], 1)


class CliTest(unittest.TestCase):
    def test_no_ticket_skips(self):
        import io
        import contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            jmd.main(["--branch", "tidy/x", "--title", "整理", "--body", "随便"])
        import json
        out = json.loads(buf.getvalue())
        self.assertEqual(out["action"], "skip")
        self.assertIsNone(out["key"])

    def test_reports_key_and_target(self):
        import io
        import contextlib
        import json
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            jmd.main(["--branch", "KAN-49-ui-audit-color", "--body", "| 全绿 | ✅ |", "--status", "审查中"])
        out = json.loads(buf.getvalue())
        self.assertEqual(out["key"], "KAN-49")
        self.assertEqual(out["target"], "已完成")


if __name__ == "__main__":
    unittest.main(verbosity=2)
