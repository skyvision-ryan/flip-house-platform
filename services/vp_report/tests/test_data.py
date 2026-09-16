"""数据层：ADF 解析、快照组装、契约校验。"""

from __future__ import annotations

import envsetup  # noqa: F401  必须最先
import unittest
from datetime import date

import jira_fixtures as fx
from app import adf, snapshot
from app.contract import (
    FETCH_FAILED, FETCH_OK, ContractError, Snapshot, validate_integrity,
)


class ADFTest(unittest.TestCase):
    def test_parses_code_block_shape(self):
        fields, missing, found = adf.parse_summary(fx.summary_block(shape="code"))
        self.assertTrue(found)
        self.assertEqual(fields["业务名称"], "手机操作，电脑同步看到")
        self.assertEqual(fields["风险判断"], "按计划")
        # 空字段如实报告缺失，不猜
        self.assertIn("验收证据", missing)

    def test_parses_paragraph_shape(self):
        fields, _missing, found = adf.parse_summary(fx.summary_block(shape="paragraph"))
        self.assertTrue(found)
        self.assertEqual(fields["业务名称"], "手机操作，电脑同步看到")

    def test_two_shapes_agree(self):
        a, _, _ = adf.parse_summary(fx.summary_block(shape="code"))
        b, _, _ = adf.parse_summary(fx.summary_block(shape="paragraph"))
        self.assertEqual(a, b)

    def test_missing_block_is_reported_not_guessed(self):
        fields, missing, found = adf.parse_summary(fx.adf_paragraphs("随便写点别的"))
        self.assertFalse(found)
        self.assertEqual(fields, {})
        self.assertEqual(len(missing), len(adf.SUMMARY_FIELDS))

    def test_placeholder_counts_as_empty(self):
        block = fx.summary_block(has_now="<已核实的业务能力>")
        fields, missing, _ = adf.parse_summary(block)
        self.assertNotIn("已经具备", fields)
        self.assertIn("已经具备", missing)

    def test_other_description_content_is_not_swallowed(self):
        """模板区之外的内容不参与解析，也不会被当成字段值。"""
        doc = {"type": "doc", "version": 1, "content": [
            {"type": "heading", "attrs": {"level": 3},
             "content": [{"type": "text", "text": "管理摘要 v1"}]},
            {"type": "paragraph", "content": [{"type": "text", "text": "业务名称：甲"}]},
            {"type": "rule"},
            {"type": "paragraph", "content": [{"type": "text", "text": "业务名称：乙"}]},
        ]}
        fields, _, found = adf.parse_summary(doc)
        self.assertTrue(found)
        self.assertEqual(fields["业务名称"], "甲")

    def test_meeting_block_end_time_may_be_unknown(self):
        fields, missing, found = adf.parse_meeting(fx.meeting_block(start="14:00", end=""))
        self.assertTrue(found)
        self.assertEqual(fields["开始"], "14:00")
        self.assertIn("结束", missing)


def build(today="2026-09-16", lanes=None, children=None, subtasks=None,
          milestones=None, meetings=None) -> Snapshot:
    return snapshot.assemble(
        lane_raw=fx.lanes() if lanes is None else lanes,
        child_raw=(fx.children() + fx.subtasks()) if children is None
        else (children + (subtasks or [])),
        milestone_raw=fx.milestones() if milestones is None else milestones,
        meeting_raw=fx.meetings() if meetings is None else meetings,
        start_field=fx.START_FIELD,
        today=date.fromisoformat(today),
        fetched_at="2026-09-16T10:00:00-07:00",
    )


class AssembleTest(unittest.TestCase):
    def test_lanes_come_from_jira_not_constants(self):
        snap = build()
        self.assertEqual([ln.jira_key for ln in snap.lines], ["KAN-35", "KAN-36"])
        self.assertEqual(snap.lines[0].title, "账号与安全上线")   # 来自管理摘要的业务名称

    def test_subtasks_are_not_double_counted(self):
        snap = build()
        lane = snap.lines[0]
        self.assertEqual(lane.total_count, 4)          # KAN-20/21/22/25，不含 KAN-41
        self.assertEqual(lane.done_count, 1)           # 只有 KAN-20
        self.assertIn("KAN-41", lane.subtasks)
        self.assertNotIn("KAN-41", lane.children)

    def test_removing_a_ticket_removes_it_from_the_lane(self):
        fewer = [c for c in fx.children() if c["key"] != "KAN-22"]
        snap = build(children=fewer, subtasks=[])
        self.assertNotIn("KAN-22", snap.lines[0].children)
        self.assertEqual(snap.lines[0].total_count, 3)

    def test_adding_a_ticket_is_picked_up(self):
        more = fx.children() + [fx.issue("KAN-70", "新执行单", parent="KAN-35",
                                         due="2026-09-19")]
        snap = build(children=more, subtasks=[])
        self.assertIn("KAN-70", snap.lines[0].children)

    def test_lanes_can_have_different_states_at_once(self):
        """不同主线分别进行中/未开始是正常的，不做"整页只许一种文案"的断言。"""
        snap = build()
        stages = [ln.stage for ln in snap.lines]
        self.assertEqual(stages[0], "进行中")
        self.assertEqual(stages[1], "未开始")

    def test_all_done_is_only_pending_acceptance(self):
        done = [fx.issue("KAN-20", "完事", parent="KAN-35", category=fx.CAT_DONE,
                         due="2026-09-16")]
        snap = build(lanes=fx.lanes()[:1], children=done, subtasks=[])
        self.assertEqual(snap.lines[0].stage, "待验收")   # 不是「已验收」

    def test_accepted_requires_evidence(self):
        lane = fx.lanes()[:1]
        lane[0]["fields"]["description"] = fx.summary_block(
            acceptance="已通过", evidence="https://example.com/pr/8",
            by="Ryan", at="2026-09-16 09:00 America/Los_Angeles")
        done = [fx.issue("KAN-20", "完事", parent="KAN-35", category=fx.CAT_DONE,
                         due="2026-09-16")]
        snap = build(lanes=lane, children=done, subtasks=[])
        self.assertEqual(snap.lines[0].stage, "已验收")

    def test_accepted_without_evidence_stays_pending(self):
        lane = fx.lanes()[:1]
        lane[0]["fields"]["description"] = fx.summary_block(acceptance="已通过", evidence="")
        done = [fx.issue("KAN-20", "完事", parent="KAN-35", category=fx.CAT_DONE,
                         due="2026-09-16")]
        snap = build(lanes=lane, children=done, subtasks=[])
        self.assertEqual(snap.lines[0].stage, "待验收")

    def test_accepted_needs_a_named_reviewer_and_a_timestamp(self):
        """没人签字、没有时间的"已验收"就是猜的。四样缺一不可。"""
        done = [fx.issue("KAN-20", "完事", parent="KAN-35", category=fx.CAT_DONE,
                         due="2026-09-16")]
        for missing, kwargs in (
            ("业务核对人", {"by": ""}),
            ("业务核对时间", {"at": ""}),
        ):
            with self.subTest(missing=missing):
                lane = fx.lanes()[:1]
                lane[0]["fields"]["description"] = fx.summary_block(
                    acceptance="已通过", evidence="https://example.com/pr/8", **kwargs)
                snap = build(lanes=lane, children=done, subtasks=[])
                self.assertEqual(snap.lines[0].stage, "待验收",
                                 f"缺{missing}也显示了已验收")

    def test_contract_refuses_an_accepted_line_without_a_reviewer(self):
        snap = build()
        line = snap.lines[0]
        line.stage = "已验收"
        line.definition_of_done = "已通过"
        line.evidence = "https://example.com/pr/8"
        line.reviewed_by = None
        with self.assertRaises(ContractError):
            validate_integrity(snap)

    def test_commitment_date_is_not_overwritten_by_rollup(self):
        lane = snapshot.build_line(
            fx.lanes()[0],
            [snapshot.parse_issue(c, fx.START_FIELD) for c in fx.children()
             if c["fields"]["parent"] and c["fields"]["parent"]["key"] == "KAN-35"],
            [], date(2026, 9, 16))
        self.assertEqual(lane.due, "2026-09-23")        # Epic 自己的承诺日
        self.assertEqual(lane.rollup_due, "2026-09-22")  # 子项汇总，另存

    def test_missing_summary_block_is_named_explicitly(self):
        lane = fx.lanes()[:1]
        lane[0]["fields"]["description"] = None
        snap = build(lanes=lane)
        self.assertTrue(any("管理摘要 v1" in m for m in snap.lines[0].missing))

    def test_milestones_and_meetings_come_from_jira(self):
        snap = build()
        titles = [m.title for m in snap.milestones]
        self.assertIn("首批房屋内部试用", titles)
        trial = next(m for m in snap.milestones if m.title == "首批房屋内部试用")
        self.assertEqual((trial.date, trial.end_date), ("2026-09-24", "2026-09-25"))
        self.assertEqual(trial.kind, "trial")
        self.assertEqual([m.date for m in snap.meetings], ["2026-09-17", "2026-09-22"])

    def test_meeting_end_time_unknown_is_preserved(self):
        snap = build()
        first = snap.meetings[0]
        self.assertEqual(first.start_time, "14:00")
        self.assertIsNone(first.end_time)       # 不自己补成 45 分钟

    def test_meeting_without_timezone_is_marked_provisional(self):
        raw = [fx.issue("KAN-61", "会", due="2026-09-17", labels=["mgmt-meeting"],
                        description=fx.meeting_block(tz=""))]
        snap = build(meetings=raw)
        self.assertTrue(snap.meetings[0].time_provisional)


class DateConflictTest(unittest.TestCase):
    """排期冲突是业务事实，不是取数失败。"""

    def test_dependency_conflict_is_reported_but_snapshot_stays_valid(self):
        snap = build()
        anomalies = snap.date_check["anomalies"]
        self.assertTrue(any("KAN-22" in a and "KAN-25" in a for a in anomalies))
        # 关键：有冲突的快照仍然是**结构完好**的，可以照常展示
        validate_integrity(snap)
        self.assertEqual(snap.fetch_status, FETCH_OK)

    def test_rollup_beyond_commitment_is_an_anomaly_not_a_failure(self):
        lane = fx.lanes()[:1]
        lane[0]["fields"]["duedate"] = "2026-09-19"      # 承诺日早于子项
        snap = build(lanes=lane)
        self.assertTrue(any("超出承诺日" in a for a in snap.date_check["anomalies"]))
        validate_integrity(snap)

    def test_inverted_dates_are_anomalies(self):
        bad = [fx.issue("KAN-20", "倒置", parent="KAN-35",
                        start="2026-09-20", due="2026-09-18")]
        snap = build(children=bad, subtasks=[])
        self.assertTrue(any("晚于截止" in a for a in snap.date_check["anomalies"]))
        validate_integrity(snap)

    def test_missing_dates_are_listed(self):
        bare = [fx.issue("KAN-20", "没日期", parent="KAN-35")]
        snap = build(children=bare, subtasks=[])
        self.assertIn("KAN-20 缺开始日期", snap.date_check["missing"])
        self.assertIn("KAN-20 缺截止日期", snap.date_check["missing"])
        validate_integrity(snap)


class PartialReachabilityTest(unittest.TestCase):
    """partial 必须是真实可达的状态，不能只存在于测试里。"""

    def test_milestone_failure_degrades_to_partial_with_a_reason(self):
        from app.jira_client import JiraError

        class FlakyClient:
            def start_date_field(self):
                return fx.START_FIELD

            def search(self, jql, fields=None):
                if "mgmt-milestone" in jql:
                    raise JiraError("里程碑查询挂了")
                if "mgmt-meeting" in jql:
                    return fx.meetings()
                if "mgmt-lane" in jql:
                    return fx.lanes()
                return fx.children()

        snap = snapshot.fetch(FlakyClient())
        self.assertEqual(snap.fetch_status, "partial")
        self.assertTrue(any("里程碑" in e for e in snap.fetch_errors))
        self.assertEqual(snap.milestones, [])
        # 主线还在——但这份缺一块的快照不该盖掉完整数据（见 test_service）
        self.assertTrue(snap.lines)


class IntegrityTest(unittest.TestCase):
    """validate_integrity 只拦结构性损坏。"""

    def test_failed_status_requires_a_reason(self):
        snap = build()
        snap.fetch_status = FETCH_FAILED
        snap.fetch_errors = []
        with self.assertRaises(ContractError):
            validate_integrity(snap)

    def test_ok_with_errors_is_contradictory(self):
        snap = build()
        snap.fetch_errors = ["取数失败"]
        with self.assertRaises(ContractError):
            validate_integrity(snap)

    def test_empty_report_is_refused(self):
        snap = build()
        snap.lines = []
        with self.assertRaises(ContractError):
            validate_integrity(snap)

    def test_accepted_without_definition_is_refused(self):
        snap = build()
        snap.lines[0].stage = "已验收"
        snap.lines[0].definition_of_done = "待核对"
        with self.assertRaises(ContractError):
            validate_integrity(snap)

    def test_unparseable_milestone_date_is_refused(self):
        snap = build()
        snap.milestones[0].date = "不是日期"
        with self.assertRaises(ContractError):
            validate_integrity(snap)


if __name__ == "__main__":
    unittest.main()
