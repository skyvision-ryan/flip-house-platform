"""报告服务自己的配置。

刻意与 backend/app/settings.py 无任何关系：这个服务不读业务数据库、不认 DEMO_MODE、
不认 X-Actor。它只需要两样东西——一个只读的 Jira 身份，和一个访问口令。
"""

from __future__ import annotations

import os

# ---- Jira 只读身份（正式运行请用专用只读账号，不要用站点管理员 token）----
JIRA_SITE = os.getenv("JIRA_SITE", "").strip().rstrip("/")
JIRA_EMAIL = os.getenv("JIRA_EMAIL", "").strip()
JIRA_TOKEN = os.getenv("JIRA_TOKEN", "").strip()
# 认证方式取决于最终创建的 token 类型，必须用真实 token 实测后再定：
#   basic  = classic API token，Basic(email:token)，打 https://<site>.atlassian.net
#   bearer = scoped token，Bearer(token)，打 https://api.atlassian.com/ex/jira/<cloudId>
JIRA_AUTH_MODE = os.getenv("JIRA_AUTH_MODE", "basic").strip()
JIRA_CLOUD_ID = os.getenv("JIRA_CLOUD_ID", "").strip()

# 取哪些 Epic 上首页：默认按标签，环境变量可整体覆盖。代码里不写死任何 issue key。
LANE_JQL = os.getenv("VP_REPORT_JQL", 'issuetype = Epic AND labels = "mgmt-lane"').strip()
MILESTONE_JQL = os.getenv("VP_REPORT_MILESTONE_JQL", 'labels = "mgmt-milestone"').strip()
MEETING_JQL = os.getenv("VP_REPORT_MEETING_JQL", 'labels = "mgmt-meeting"').strip()

# 开始日期是自定义字段，字段号因站点而异。留空则运行时按字段类型+名称发现。
JIRA_START_FIELD = os.getenv("JIRA_START_FIELD", "").strip()

# ---- 访问控制 ----
REPORT_PASSCODE = os.getenv("REPORT_PASSCODE", "")
# 固定密钥：设了才能在重启后保住会话。没设一律 503，绝不退化成随机密钥。
REPORT_SECRET = os.getenv("REPORT_SECRET", "")
SESSION_DAYS = int(os.getenv("REPORT_SESSION_DAYS", "30"))
# 本地开发用 http 时设 0；线上必须是 1
COOKIE_SECURE = os.getenv("REPORT_COOKIE_SECURE", "1").strip().lower() not in ("0", "false", "no", "off")

# ---- 刷新节奏 ----
CACHE_TTL_SECONDS = int(os.getenv("REPORT_CACHE_TTL", "300"))       # 服务端缓存 5 分钟
MANUAL_REFRESH_COOLDOWN = int(os.getenv("REPORT_REFRESH_COOLDOWN", "60"))
# 上一次取数失败后，至少隔这么久才自动重试。没有它，每次打开页面都会再打一次
# Jira，页面还会在「正在同步」和「暂不可用」之间反复横跳。
RETRY_COOLDOWN_SECONDS = int(os.getenv("REPORT_RETRY_COOLDOWN", "30"))
HTTP_CONNECT_TIMEOUT = float(os.getenv("REPORT_HTTP_CONNECT_TIMEOUT", "5"))
HTTP_READ_TIMEOUT = float(os.getenv("REPORT_HTTP_READ_TIMEOUT", "15"))

# ---- 口令错误尝试限制 ----
MAX_ATTEMPTS = int(os.getenv("REPORT_MAX_ATTEMPTS", "5"))
ATTEMPT_WINDOW_SECONDS = int(os.getenv("REPORT_ATTEMPT_WINDOW", "900"))
# Render 等平台在前面放了反向代理。这里声明可信代理层数，用于从
# X-Forwarded-For 右端回退取真实客户端 IP。设 0 表示不信任任何代理头。
TRUSTED_PROXY_HOPS = int(os.getenv("REPORT_TRUSTED_PROXY_HOPS", "1"))

TIMEZONE = "America/Los_Angeles"


def jira_configured() -> bool:
    return bool(JIRA_SITE and JIRA_EMAIL and JIRA_TOKEN)


def access_configured() -> bool:
    return bool(REPORT_PASSCODE and REPORT_SECRET)


def missing_config() -> list[str]:
    """给服务端日志用。**不要**把这个列表发给客户端或健康检查响应。"""
    missing = []
    for name, value in (
        ("JIRA_SITE", JIRA_SITE), ("JIRA_EMAIL", JIRA_EMAIL), ("JIRA_TOKEN", JIRA_TOKEN),
        ("REPORT_PASSCODE", REPORT_PASSCODE), ("REPORT_SECRET", REPORT_SECRET),
    ):
        if not value:
            missing.append(name)
    return missing
