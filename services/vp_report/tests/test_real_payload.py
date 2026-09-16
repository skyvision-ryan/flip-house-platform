"""用**真实 Jira 存下来的 ADF** 验证解析器。

其他测试用的是我们自己造的 fixture——形状对不对是我们说了算。
这一份不一样：下面的 ADF 是 2026-09-16 从 KAN-41 原样读回来的，
证明「模板贴进 Jira 之后，Jira 实际存成什么样」和解析器的假设一致。

背景：模板在维护文档里是以代码块给出的。Jira 把它存成了**一个 codeBlock 节点、
整段文字在一个 text 子节点里**（不是一行一个 paragraph）。如果哪天 Jira 改了
存储形状，或者有人改了模板写法，这条会先红。
"""

from __future__ import annotations

import envsetup  # noqa: F401
import unittest

from app import adf, snapshot

# ---- 2026-09-16 从 KAN-41 读回的原始 description，未经修改 ----
KAN_41_DESCRIPTION = {
    "type": "doc",
    "version": 1,
    "content": [
        {
            "type": "paragraph",
            "content": [
                {"type": "text", "text": "本工作项是"},
                {"type": "text", "text": "管理层进度报告的会议记录",
                 "marks": [{"type": "strong"}]},
                {"type": "text", "text": "，供 KAN-40 的报告页读取，不是开发执行单。\n"
                                         "会议时间与结论维护在下面的固定模板区（PM 维护）。"
                                         "Jira 的截止日期只有日期没有时刻，所以时刻写在模板里。"},
            ],
        },
        {
            "type": "codeBlock",
            "content": [
                {"type": "text", "text": "会议纪要 v1\n开始：14:00\n结束：\n"
                                         "时区：America/Los_Angeles\n参与人：Ryan、J、PM\n"
                                         "目的：确认内部试用的范围、人员、验收方式与职责\n"
                                         "待决问题：试用房屋数量与选择；业务验收由谁签字\n决议："},
            ],
        },
        {
            "type": "paragraph",
            "content": [
                {"type": "text", "text": "说明：结束时间尚未确认，"},
                {"type": "text", "text": "请勿", "marks": [{"type": "strong"}]},
                {"type": "text", "text": "在确认前填写具体时长。会后请回填「决议」与剩余的「待决问题」。"},
            ],
        },
    ],
}

# 真实工作项的其余字段，同样来自那次读取
KAN_41_RAW = {
    "key": "KAN-41",
    "fields": {
        "summary": "试用方案确认会（2026-09-17 14:00 PT）",
        "issuetype": {"name": "任务", "subtask": False, "hierarchyLevel": 0},
        "status": {"name": "待办", "statusCategory": {"key": "new"}},
        "parent": None,
        "duedate": "2026-09-17",
        "customfield_10015": "2026-09-17",
        "labels": ["mgmt-meeting"],
        "issuelinks": [],
        "description": KAN_41_DESCRIPTION,
        "assignee": None,
    },
}


class RealMeetingPayloadTest(unittest.TestCase):
    def test_jira_stores_the_template_as_one_code_block(self):
        """解析器的核心假设：整段模板在一个 codeBlock 的一个 text 节点里。"""
        nodes = KAN_41_DESCRIPTION["content"]
        code_blocks = [n for n in nodes if n["type"] == "codeBlock"]
        self.assertEqual(len(code_blocks), 1)
        self.assertEqual(len(code_blocks[0]["content"]), 1)
        self.assertTrue(code_blocks[0]["content"][0]["text"].startswith("会议纪要 v1"))

    def test_parses_the_real_stored_block(self):
        fields, missing, found = adf.parse_meeting(KAN_41_DESCRIPTION)
        self.assertTrue(found, "解析不到真实 Jira 存下来的会议纪要区")
        self.assertEqual(fields["开始"], "14:00")
        self.assertEqual(fields["时区"], "America/Los_Angeles")
        self.assertEqual(fields["参与人"], "Ryan、J、PM")
        self.assertEqual(fields["目的"], "确认内部试用的范围、人员、验收方式与职责")
        # 结束与决议是空的——如实报缺，不猜
        self.assertIn("结束", missing)
        self.assertIn("决议", missing)

    def test_surrounding_prose_is_not_mistaken_for_fields(self):
        """模板前后的说明文字不能被当成字段值。"""
        fields, _, _ = adf.parse_meeting(KAN_41_DESCRIPTION)
        for value in fields.values():
            self.assertNotIn("请勿", value)
            self.assertNotIn("本工作项是", value)

    def test_builds_a_meeting_the_page_can_show(self):
        meeting = snapshot.build_meeting(KAN_41_RAW)
        self.assertEqual(meeting.date, "2026-09-17")
        self.assertEqual(meeting.start_time, "14:00")
        self.assertIsNone(meeting.end_time)          # 不自己补成 45 分钟
        self.assertFalse(meeting.time_provisional)   # 写了时区，不是暂定
        self.assertEqual(meeting.jira_key, "KAN-41")
        self.assertTrue(any("结束" in m for m in meeting.missing))


if __name__ == "__main__":
    unittest.main()
