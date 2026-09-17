"""测试环境变量。**必须在 import app.* 之前导入**（settings 在 import 时读环境）。

这里刻意设了 DEMO_MODE=1：业务系统的演示开关对报告服务必须完全无效。
如果哪天有人把业务鉴权逻辑抄进来，test_service 里的 401 断言会立刻失败。
"""

from __future__ import annotations

import os

os.environ.setdefault("JIRA_SITE", "https://example.atlassian.net")
os.environ.setdefault("JIRA_EMAIL", "report-bot@example.com")
os.environ.setdefault("JIRA_TOKEN", "test-token")
os.environ.setdefault("REPORT_PASSCODE", "kan40-test")
os.environ.setdefault("REPORT_SECRET", "fixed-secret-for-tests")
os.environ.setdefault("REPORT_COOKIE_SECURE", "0")   # TestClient 走 http
os.environ.setdefault("REPORT_TRUSTED_PROXY_HOPS", "0")

# 业务系统的开关，报告服务必须完全不受影响
os.environ.setdefault("DEMO_MODE", "1")
