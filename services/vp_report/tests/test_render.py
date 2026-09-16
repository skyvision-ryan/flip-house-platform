"""渲染层：时间轴自适应、转义、链接白名单。"""

from __future__ import annotations

import envsetup  # noqa: F401
import re
import unittest
from datetime import date

import jira_fixtures as fx
from app import render, snapshot


_DEFAULT = object()


def _pick(kwargs, name, default):
    """注意别用 `or`——空列表是合法输入（"这类记录一条都没有"）。"""
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
    state = {"status": kwargs.pop("status", "ok"),
             "snapshot": snap_dict(**kwargs),
             "fetched_at": "2026-09-16T10:00:00-07:00",
             "last_error": None, "refreshing": False}
    return render.report_page(state, "testnonce")


class AxisTest(unittest.TestCase):
    def test_axis_follows_the_data_not_a_fixed_fortnight(self):
        early = render.Axis.from_snapshot(snap_dict(), date(2026, 9, 16))
        later = fx.lanes()
        for epic in later:
            epic["fields"]["duedate"] = "2026-11-30"
        wide = render.Axis.from_snapshot(
            snap_dict(lanes=later), date(2026, 9, 16))
        self.assertNotEqual((early.start, early.end), (wide.start, wide.end))
        self.assertGreater(wide.span, early.span)

    def test_today_is_always_inside_the_axis(self):
        today = date(2026, 12, 25)          # 远在所有排期之后
        axis = render.Axis.from_snapshot(snap_dict(), today)
        self.assertLessEqual(axis.start, today)
        self.assertGreaterEqual(axis.end, today)
        self.assertTrue(0 <= axis.pos(today) <= 100)

    def test_minimum_span_avoids_a_degenerate_chart(self):
        one_day = [fx.issue("KAN-35", "只有一天", epic=True, labels=["mgmt-lane"],
                            start="2026-09-16", due="2026-09-16",
                            description=fx.summary_block())]
        axis = render.Axis.from_snapshot(
            snap_dict(lanes=one_day, children=[], milestones=[], meetings=[]),
            date(2026, 9, 16))
        self.assertGreaterEqual(axis.span, render.Axis.MIN_SPAN_DAYS)

    def test_ticks_are_generated_not_hardcoded(self):
        axis = render.Axis(date(2026, 9, 14), date(2026, 9, 28))
        ticks = axis.ticks()
        self.assertGreaterEqual(len(ticks), 4)
        self.assertEqual(ticks[0], axis.start)
        self.assertEqual(ticks[-1], axis.end)


class EscapingTest(unittest.TestCase):
    """Jira 返回的一切都是不可信输入。"""

    def setUp(self):
        self.html = page(lanes=fx.hostile_lanes(), children=fx.hostile_children(),
                         milestones=[], meetings=[])

    def test_script_tag_from_jira_is_escaped(self):
        self.assertIn("业务 &lt;script&gt;", self.html)
        # 页面里除了我们自己的 nonce script，不该有别的 <script
        scripts = re.findall(r"<script(?![^>]*nonce=)", self.html)
        self.assertEqual(scripts, [], "出现了没有 nonce 的 script 标签")

    def test_quote_breakout_is_escaped(self):
        self.assertNotIn('onmouseover="alert(1)"', self.html)
        self.assertIn("&quot;", self.html)

    def test_external_url_from_description_never_becomes_a_link(self):
        """描述里写了 javascript: URL 也只能是文字，绝不能进 href。"""
        self.assertIn(fx.XSS_URL, self.html)          # 作为文字如实显示
        self.assertNotIn(f'href="{fx.XSS_URL}"', self.html)
        self.assertNotIn('href="javascript:', self.html)

    def test_only_verified_jira_links_are_emitted(self):
        hrefs = re.findall(r'href="([^"]+)"', self.html)
        for href in hrefs:
            self.assertTrue(
                href.startswith("https://example.atlassian.net/browse/"),
                f"出现了非白名单链接：{href}")

    def test_bad_issue_key_yields_plain_text_not_a_link(self):
        self.assertIsNone(render.jira_url("not a key"))
        self.assertIsNone(render.jira_url("KAN-40; DROP"))
        self.assertIsNone(render.jira_url(None))
        self.assertEqual(render.jira_url("KAN-40"),
                         "https://example.atlassian.net/browse/KAN-40")


class ReportPageTest(unittest.TestCase):
    def test_plan_dates_and_completion_are_expressed_separately(self):
        html = page()
        self.assertIn("横条为计划时间，非完成进度", html)
        self.assertIn("日期走过不代表完成", html)

    def test_completed_ticket_shows_a_check_and_others_do_not(self):
        html = page()
        self.assertIn('class="dot d ', html)     # KAN-20 已完成
        self.assertRegex(html, r'class="dot g\d+"')   # 其余未完成

    def test_lane_states_differ_per_lane(self):
        html = page()
        self.assertIn("正在推进", html)
        self.assertIn("尚未开始", html)

    def test_schedule_conflict_appears_under_attention(self):
        html = page()
        self.assertIn("需要关注", html)
        self.assertIn("KAN-22", html)

    def test_scope_is_stated_without_leaking_account_or_jql(self):
        html = page()
        self.assertIn("受当前读取账号可见范围限制", html)
        self.assertNotIn("report-bot@example.com", html)
        self.assertNotIn("mgmt-lane", html)          # JQL 不上页面
        self.assertNotIn("test-token", html)

    def test_sync_time_is_the_successful_fetch_not_render_time(self):
        html = page()
        self.assertIn("最后成功同步 2026-09-16 10:00", html)
        self.assertIn("业务核对", html)

    def test_stale_banner_names_the_time_of_the_old_data(self):
        html = page(status="stale")
        self.assertIn("更新暂时失败", html)
        self.assertIn("2026-09-16 10:00", html)

    def test_missing_meeting_records_are_named_not_faked(self):
        html = page(meetings=[])
        self.assertIn("待确认", html)
        self.assertIn("mgmt-meeting", html)

    def test_meeting_without_end_time_says_so(self):
        html = page()
        self.assertIn("结束时间待确认", html)

    def test_no_inline_style_attributes_survive_csp(self):
        """CSP 的 style-src 'nonce-x' 会拦掉行内 style 属性——出现一个，
        时间轴/今天线/颜色就会在真机上整块失效，而字符串断言看不出来。"""
        for html in (page(), render.passcode_page("n"), render.loading_page("n"),
                     render.unavailable_page({}, "n")):
            self.assertNotIn('style="', html)
            self.assertNotIn("style='", html)

    def test_computed_positions_land_in_the_nonced_stylesheet(self):
        html = page()
        # (?s) 让 . 匹配换行——CSS 是多行的
        self.assertRegex(html, r'(?s)<style nonce="testnonce">.*\.g\d+\{left:')

    def test_no_horizontal_scroll_hint_for_phone(self):
        html = page()
        self.assertIn("width=device-width", html)
        self.assertIn("max-width:430px", html)


class GatePageTest(unittest.TestCase):
    def test_passcode_page_is_chinese_and_posts_to_login(self):
        html = render.passcode_page("n")
        self.assertIn("请输入访问口令", html)
        self.assertIn('action="/login"', html)
        self.assertIn('type="password"', html)

    def test_error_message_is_escaped(self):
        html = render.passcode_page("n", '<script>x</script>')
        self.assertNotIn("<script>x</script>", html)


if __name__ == "__main__":
    unittest.main()
