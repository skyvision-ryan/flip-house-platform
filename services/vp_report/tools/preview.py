#!/usr/bin/env python3
"""本地预览：用合成数据把真实服务跑起来，好在**真浏览器**里看。

为什么需要它：TestClient 只能证明输出的字符串和响应头，证明不了
"CSP 没把样式拦掉""脚本没有执行""手机上布局没垮"。这些只能真机/真浏览器看。

不是产品代码，不会被 app 导入，也不会打进部署镜像。

    python tools/preview.py            # 正常数据，开在 8100
    python tools/preview.py --hostile  # 喂含 <script>、引号的脏数据
"""

from __future__ import annotations

import argparse
import os
import pathlib
import sys
from datetime import date

HERE = pathlib.Path(__file__).resolve().parent
SERVICE = HERE.parent

# 预览用的配置，跟测试一致
os.environ.setdefault("JIRA_SITE", "https://example.atlassian.net")
os.environ.setdefault("JIRA_EMAIL", "report-bot@example.com")
os.environ.setdefault("JIRA_TOKEN", "preview-token")
os.environ.setdefault("REPORT_PASSCODE", "kan40-test")
os.environ.setdefault("REPORT_SECRET", "preview-secret")
os.environ.setdefault("REPORT_COOKIE_SECURE", "0")   # 本地是 http
os.environ.setdefault("REPORT_TRUSTED_PROXY_HOPS", "0")

sys.path.insert(0, str(SERVICE))
sys.path.insert(0, str(SERVICE / "tests"))

import jira_fixtures as fx          # noqa: E402
from app import main, snapshot      # noqa: E402
from app.store import SnapshotStore  # noqa: E402


def make_snapshot(hostile: bool):
    if hostile:
        lanes, children = fx.hostile_lanes(), fx.hostile_children()
        milestones = [fx.issue("KAN-88", f"里程碑 {fx.XSS}", due="2026-09-18",
                               labels=["mgmt-milestone"])]
        meetings = [fx.issue("KAN-89", f"会议 {fx.XSS}", due="2026-09-17",
                             labels=["mgmt-meeting"],
                             description=fx.meeting_block(
                                 purpose=f"目的 {fx.XSS}", outcome=f"结论 {fx.XSS}"))]
    else:
        lanes, children = fx.lanes(), fx.children() + fx.subtasks()
        milestones, meetings = fx.milestones(), fx.meetings()
    return snapshot.assemble(
        lane_raw=lanes, child_raw=children,
        milestone_raw=milestones, meeting_raw=meetings,
        start_field=fx.START_FIELD, today=date(2026, 9, 16),
        fetched_at="2026-09-16T10:00:00-07:00")


def main_cli() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hostile", action="store_true", help="喂含脚本标签和引号的脏数据")
    ap.add_argument("--port", type=int, default=8100)
    ap.add_argument("--no-auth", action="store_true",
                    help="跳过口令，方便 headless 浏览器直接截图（仅本工具）")
    args = ap.parse_args()

    if args.no_auth:
        # 只在这个开发工具里放行，产品代码一个字没改：
        # headless 浏览器不方便带 cookie，但 CSP 与渲染才是要验的东西。
        main.auth.is_authed = lambda request: True

    store = SnapshotStore(lambda: make_snapshot(args.hostile))
    store.refresh_blocking()
    main.store = store

    import uvicorn
    print(f"预览地址 http://127.0.0.1:{args.port}/   口令 kan40-test")
    uvicorn.run(main.app, host="127.0.0.1", port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    raise SystemExit(main_cli())
