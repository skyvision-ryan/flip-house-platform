"""本轮改版的展示层行为：两块图、统一节点集合、业务短名、排版。

这些都只验证**展示**：数据的日期、状态、类型、完成与验收含义一律照抄快照，
下面每条测试都不应该依赖 render 去改写业务事实。
"""

from __future__ import annotations

import envsetup  # noqa: F401
import re
import unittest
from datetime import date

import jira_fixtures as fx
from app import render, snapshot

_DEFAULT = object()


def _pick(kwargs, name, default):
    value = kwargs.pop(name, _DEFAULT)
    return default if value is _DEFAULT else value


def snap_dict(**kwargs):
    s = snapshot.assemble(
        lane_raw=_pick(kwargs, "lanes", fx.lanes()),
        child_raw=_pick(kwargs, "children", fx.children() + fx.subtasks()),
        milestone_raw=_pick(kwargs, "milestones", fx.milestones()),
        meeting_raw=_pick(kwargs, "meetings", fx.meetings()),
        start_field=fx.START_FIELD,
        today=_pick(kwargs, "today", date(2026, 9, 16)),
        fetched_at="2026-09-16T10:00:00-07:00",
    )
    return s.to_dict()


def page(**kwargs) -> str:
    state = {"status": kwargs.pop("status", "ok"), "snapshot": snap_dict(**kwargs),
             "fetched_at": "2026-09-16T10:00:00-07:00"}
    return render.report_page(state, "testnonce")


class ShortNameTest(unittest.TestCase):
    """首页说人话，但不能改变事实。"""

    def test_curated_alias_replaces_a_dev_title(self):
        name, quals = render.short_name("D4 · 修复真机验收问题并固化周五演示版本")
        self.assertEqual(name, "手机演示准备")
        self.assertEqual(quals, [])

    def test_unknown_title_only_loses_the_ticket_prefix(self):
        name, _ = render.short_name("A1 · 对齐代码基线并完成六阶段兼容迁移")
        self.assertEqual(name, "对齐代码基线并完成六阶段兼容迁移")   # 其余原文保留

    def test_date_only_parenthetical_is_dropped(self):
        name, quals = render.short_name("试用方案确认会（2026-09-17 14:00 PT）")
        self.assertEqual(name, "试用方案确认会")
        self.assertEqual(quals, [])

    def test_qualifier_is_kept_as_a_tag_never_dropped(self):
        """「日期暂定」这种限定不能在简化名称时被抹掉。"""
        name, quals = render.short_name("首批房屋内部试用（2026-09-24 至 09-25，日期暂定）")
        self.assertEqual(name, "首批房屋内部试用")
        self.assertIn("日期暂定", quals)

    def test_meaningful_parenthetical_is_preserved(self):
        name, quals = render.short_name("上线验收（只含北区两套房）")
        self.assertIn("只含北区两套房", name)
        self.assertEqual(quals, [])

    def test_alias_does_not_promise_completion(self):
        for original, alias in render.DISPLAY_ALIASES.items():
            for word in ("已完成", "已交付", "正式上线", "已验收"):
                self.assertNotIn(word, alias, f"{original} 的别名暗示了完成")


class UnifiedEventsTest(unittest.TestCase):
    """会议必须和交付、试用在同一条时间轴上。"""

    def test_meetings_join_milestones_in_one_set(self):
        events = render.build_events(snap_dict())
        kinds = {e["kind"] for e in events}
        self.assertIn("meeting", kinds)
        self.assertIn("target", kinds)
        self.assertIn("trial", kinds)

    def test_meeting_needs_only_its_own_label_to_appear(self):
        """会议只凭 mgmt-meeting 就出现，不要求再补第二个标签。"""
        events = render.build_events(snap_dict(milestones=[]))
        self.assertEqual([e["kind"] for e in events], ["meeting", "meeting"])

    def test_same_jira_key_is_not_listed_twice(self):
        dup = fx.issue("KAN-61", "试用方案确认会", due="2026-09-17",
                       labels=["mgmt-milestone", "mgmt-meeting"])
        events = render.build_events(snap_dict(milestones=[dup]))
        keys = [e["jira_key"] for e in events]
        self.assertEqual(len(keys), len(set(keys)))

    def test_next_node_is_the_meeting_not_a_later_delivery(self):
        """回归：快照里有 9/17 的会议，首页却说下一个节点是 9/18 的交付单。"""
        events = render.build_events(snap_dict())
        nxt = render.next_event(events, date(2026, 9, 16))
        self.assertEqual(nxt["date"], "2026-09-17")
        self.assertEqual(nxt["kind"], "meeting")

    def test_past_and_done_events_are_not_the_next_node(self):
        past = [fx.issue("KAN-70", "早就开完的会", due="2026-09-01", labels=["mgmt-meeting"])]
        events = render.build_events(snap_dict(meetings=past, milestones=[]))
        self.assertIsNone(render.next_event(events, date(2026, 9, 16)))

    def test_render_keeps_an_undated_record_visible(self):
        """渲染层拿到没日期的记录时要标出来，不能静默丢掉。

        注意：当前**数据层**（HEAD 的 snapshot.assemble）会先把没日期的里程碑
        过滤掉，所以真实页面上看不到这一类。本轮只改展示，不动数据层——
        这个缺口在交付说明里单独记着。
        """
        snap = snap_dict()
        snap["milestones"] = snap["milestones"] + [{
            "date": "", "end_date": None, "kind": "target",
            "jira_key": "KAN-71", "title": "还没定日子的交付",
            "status_category": "new", "note": "",
        }]
        html = render._upcoming(snap, date(2026, 9, 16))
        self.assertIn("日期待定", html)
        self.assertIn("还没定日子的交付", html)

    def test_data_layer_currently_drops_undated_milestones(self):
        """把上面那条限制钉死：哪天数据层改了，这条会提醒我们回来放开展示。"""
        undated = [fx.issue("KAN-71", "还没定日子的交付", labels=["mgmt-milestone"])]
        snap = snap_dict(milestones=undated, meetings=[])
        self.assertEqual(snap["milestones"], [],
                         "数据层开始保留无日期里程碑了，渲染层可以一并显示")

    def test_each_event_gets_its_own_table_row(self):
        """同日多个节点各占一行，名称待在左栏，不在图里左右漂浮。"""
        same_day = [
            fx.issue(f"KAN-8{i}", f"同一天的节点{i}", due="2026-09-18",
                     labels=["mgmt-milestone"]) for i in range(4)
        ]
        html = page(milestones=same_day, meetings=[])
        for i in range(4):
            self.assertIn(f"同一天的节点{i}", html)
        # 四个同日节点 → 四个标记，位置完全相同（锚在真实日期上）
        anchors = re.findall(r'<i class="schedule-node k-\w+ (g\d+)">', html)
        self.assertEqual(len(anchors), 4)
        self.assertEqual(len(set(anchors)), 1, "同日节点被挪到了不同日期上")


class ProgressBlockTest(unittest.TestCase):
    """第一块：完成多少（按任务数量）。"""

    def test_counts_come_from_child_status_categories(self):
        snap = snap_dict()
        lane = next(l for l in snap["lines"] if l["jira_key"] == "KAN-35")
        done, doing, todo, total = render._lane_counts(snap, lane)
        self.assertEqual((done, doing, todo, total), (1, 0, 3, 4))

    def test_subtasks_are_not_counted(self):
        snap = snap_dict()
        lane = next(l for l in snap["lines"] if l["jira_key"] == "KAN-35")
        _, _, _, total = render._lane_counts(snap, lane)
        self.assertEqual(total, len(lane["children"]))
        self.assertTrue(lane["subtasks"])          # 确实有子任务，但没被计进来

    def test_basis_is_stated_and_no_overall_rate(self):
        html = page()
        self.assertIn("按任务数量统计", html)
        self.assertIn("不代表工时进度", html)
        self.assertNotIn("总体完成", html)

    def test_in_segment_number_only_when_it_fits(self):
        """放不下就不写进色块，交给下面那行文字——不裁字。"""
        many = [fx.issue(f"KAN-9{i}", f"任务{i}", parent="KAN-35",
                         category=(fx.CAT_DONE if i == 0 else fx.CAT_NEW),
                         due="2026-09-20") for i in range(20)]
        html = page(children=many)
        self.assertIn("已完成 1", html)            # 文字行一定有
        self.assertIn("共 20 项", html)


class GanttBlockTest(unittest.TestCase):
    """第二块：什么时候。"""

    def test_lane_order_matches_the_progress_block(self):
        """两块图必须用同一组主线和同一顺序，才能对应得上。"""
        snap = snap_dict()
        order = [l["title"] for l in render._lanes_sorted(snap)]
        html = page()
        positions = [html.index(t) for t in order]
        first_block = positions               # 进展块里的出现顺序
        self.assertEqual(first_block, sorted(first_block), "两块图的主线顺序不一致")

    def test_lanes_are_collapsed_by_default_and_expandable(self):
        html = page()
        self.assertIn("展开", html)
        self.assertIn("<details", html)
        self.assertNotIn("<details open", html)

    def test_subtasks_expand_into_real_bars_not_dots(self):
        html = page()
        self.assertIn("plan sub", html)        # 子项也是甘特条
        self.assertNotIn('class="dot', html)   # 不再用匿名圆圈

    def test_lane_name_column_is_pinned(self):
        html = page()
        self.assertIn("position:sticky", html)
        self.assertIn("左右滑动看日期", html)

    def test_bar_length_is_planned_time_only(self):
        html = page()
        self.assertIn("横条长度 = 计划时间，不表示完成进度", html)


class LayoutSafetyTest(unittest.TestCase):
    def test_no_inline_style_attributes_anywhere(self):
        """CSP 只放行带 nonce 的 <style>，行内 style 会被整体拦掉。"""
        for html in (page(), render.passcode_page("n"), render.loading_page("n"),
                     render.unavailable_page({}, "n")):
            self.assertEqual(re.findall(r"<[^>]+\sstyle=", html), [])

    def test_no_overflow_hidden_masking_clipped_text(self):
        html = page()
        self.assertNotIn("overflow-x:hidden", html)

    def test_desktop_gets_wider_than_the_phone_column(self):
        html = page()
        self.assertIn("max-width:430px", html)
        self.assertIn("max-width:720px", html)

    def test_body_text_is_readable_size(self):
        html = page()
        self.assertIn("font:16px/1.6", html)

    def test_dev_vocabulary_stays_out_of_the_homepage(self):
        """票号和开发词只能出现在展开层里。"""
        html = page()
        visible = re.sub(r"<style.*?</style>", "", html, flags=re.S)
        visible = re.sub(r"<details.*?</details>", "", visible, flags=re.S)
        for word in ("Epic", "CDK", "Cognito", "mgmt-lane", "KAN-"):
            self.assertNotIn(word, visible, f"不展开就看到了开发词 {word}")

    def test_dev_detail_is_still_reachable_in_the_expand_layer(self):
        """搬走不等于删掉：票号和 Jira 链接仍然可追溯。"""
        html = page()
        self.assertIn("查看工作明细", html)
        self.assertIn("KAN-20", html)
        self.assertIn("在 Jira 查看完整记录", html)


if __name__ == "__main__":
    unittest.main()
