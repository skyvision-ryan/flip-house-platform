"""Schedule regressions that protect dates and business meaning, not screenshots.

Sticky geometry and touch scrolling require the real browser checks documented
in the service README; a CSS string assertion cannot prove those behaviours.
"""
from datetime import date
import re
import unittest

import envsetup  # noqa: F401
from app import render
from test_render_layout import snap_dict


class ScheduleTest(unittest.TestCase):
    def chart(self, snap):
        today = date(2026, 9, 16)
        axis = render.Axis.from_snapshot(snap, today)
        sheet = render.StyleSheet()
        return render._gantt(snap, axis, today, sheet), sheet.css(), axis

    def test_child_start_before_epic_is_included_in_the_calendar(self):
        snap = snap_dict()
        snap['issues'][0]['start'] = '2026-08-24'
        _, _, axis = self.chart(snap)
        self.assertLess(axis.start, date(2026, 8, 24))

    def test_single_day_and_inclusive_intervals_have_real_day_widths(self):
        snap = snap_dict()
        snap['lines'][0].update(start='2026-09-16', due='2026-09-16')
        _, css, _ = self.chart(snap)
        self.assertIn('--length:1}', css)
        self.assertIn('--length:2}', css)  # 9/16–9/17 includes both dates

    def test_missing_and_reversed_dates_do_not_create_bars(self):
        snap = snap_dict()
        snap['lines'] = [dict(snap['lines'][0], children=[], start='2026-09-23', due='2026-09-15')]
        snap['milestones'] = []
        snap['meetings'] = []
        html, css, _ = self.chart(snap)
        self.assertIn('9/23–9/15 · 日期倒置，待核对', html)
        self.assertNotIn('--length:', css)
        snap['lines'][0]['start'] = None
        html, css, _ = self.chart(snap)
        self.assertIn('截止 9/15 · 开始待确认', html)
        self.assertNotIn('--length:', css)

    def test_bad_trial_interval_is_visible_but_not_drawn_as_a_point(self):
        snap = snap_dict()
        snap['lines'] = []
        snap['meetings'] = []
        snap['milestones'] = [dict(snap['milestones'][-1], date='2026-09-25', end_date='2026-09-24')]
        html, css, _ = self.chart(snap)
        self.assertIn('日期倒置，待核对', html)
        self.assertNotIn('--length:', css)
        self.assertNotIn('class="schedule-node', html)

    def test_completed_nodes_are_marked_and_not_the_jump_target(self):
        snap = snap_dict()
        snap['meetings'] = []
        snap['milestones'][0]['status_category'] = 'done'
        html, _, _ = self.chart(snap)
        self.assertIn('交付 · 已完成', html)
        self.assertRegex(html, r'class="schedule-node [^"]+">✓</i>')
        self.assertRegex(html, r'data-row="schedule-event-1"')

    def test_past_meetings_are_not_assumed_completed_or_still_waiting(self):
        snap = snap_dict()
        snap['meetings'][0]['date'] = '2026-09-01'
        html, _, _ = self.chart(snap)
        self.assertNotIn('待开会', html)
        self.assertNotIn('会议 · 已完成', html)

    def test_child_qualifiers_survive_the_short_title(self):
        snap = snap_dict()
        snap['issues'][0]['summary'] = '测试工作（日期暂定）'
        html, _, _ = self.chart(snap)
        self.assertIn('日期暂定', html)

    def test_calendar_contains_each_day_once_including_month_boundary(self):
        snap = snap_dict()
        snap['lines'][0]['due'] = '2026-10-02'
        html, _, axis = self.chart(snap)
        self.assertEqual(len(re.findall('class="schedule-day(?: |")', html)), axis.span + 1)
        self.assertIn('<span>1</span><small>10月</small>', html)
        self.assertEqual(html.count('class="schedule-day is-today"'), 1)

    def test_empty_schedule_still_explains_missing_data(self):
        snap = snap_dict(lanes=[], children=[], meetings=[], milestones=[])
        html, _, _ = self.chart(snap)
        self.assertIn('还没有排定的会议或交付节点', html)
        self.assertNotIn('data-jump=', html)


if __name__ == '__main__':
    unittest.main()
