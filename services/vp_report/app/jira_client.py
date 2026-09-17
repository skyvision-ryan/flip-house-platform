"""Jira Cloud 只读客户端。

与 scripts/jira.py 的区别（那个是给命令行流程用的，不能直接拿来当库）：
- 出错**抛异常**，不 sys.exit —— 作为库被导入时 sys.exit 会杀掉整个服务进程。
- 有真正的分页：enhanced search 用 nextPageToken，取不完必须如实报告，
  不能把「取了一页」当成「取完了」。
- 所有超时显式声明。
- 异常信息一律脱敏：token、email、JQL 都不进错误文本、不进日志。

用当前的 enhanced search `/rest/api/3/search/jql`，不接正在移除的旧
`/rest/api/3/search`。Jira 搜索有短暂索引延迟，不承诺秒级同步。

认证方式取决于 token 类型，两种都支持（见 README「Jira 凭证」一节）：
- classic API token → Basic(email:token)，base = https://<site>.atlassian.net
- scoped token      → Bearer(token)，base = https://api.atlassian.com/ex/jira/<cloudId>
真实采用哪种必须实测 `verify_auth()`，不能只靠 mock 证明可用。
"""

from __future__ import annotations

import base64
from typing import Any

import httpx

from . import settings

# 一次查询最多翻多少页。取不完不是「没有更多」，是取数不完整，必须报错。
MAX_PAGES = 20
PAGE_SIZE = 100

DEFAULT_FIELDS = [
    "summary", "status", "issuetype", "parent", "duedate",
    "assignee", "labels", "issuelinks", "description",
]


class JiraError(RuntimeError):
    """Jira 取数失败。消息已脱敏，可以安全写日志。"""


class JiraIncomplete(JiraError):
    """分页没取完。这是取数不完整，不是「结果就这么多」。"""


def _redact(text: str) -> str:
    """把可能出现在上游响应里的凭证片段抹掉。"""
    out = text
    for secret in (settings.JIRA_TOKEN, settings.JIRA_EMAIL):
        if secret:
            out = out.replace(secret, "***")
    return out


class JiraClient:
    def __init__(
        self,
        site: str | None = None,
        email: str | None = None,
        token: str | None = None,
        auth_mode: str | None = None,
        cloud_id: str | None = None,
    ) -> None:
        self.site = (site if site is not None else settings.JIRA_SITE).rstrip("/")
        self.email = email if email is not None else settings.JIRA_EMAIL
        self.token = token if token is not None else settings.JIRA_TOKEN
        self.auth_mode = (auth_mode if auth_mode is not None else settings.JIRA_AUTH_MODE).lower()
        self.cloud_id = cloud_id if cloud_id is not None else settings.JIRA_CLOUD_ID
        self._start_field: str | None = settings.JIRA_START_FIELD or None

    # ---- 底层 ----

    @property
    def base_url(self) -> str:
        if self.auth_mode == "bearer":
            if not self.cloud_id:
                raise JiraError("scoped token 模式需要 JIRA_CLOUD_ID")
            return f"https://api.atlassian.com/ex/jira/{self.cloud_id}"
        return self.site

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if self.auth_mode == "bearer":
            headers["Authorization"] = f"Bearer {self.token}"
        else:
            raw = f"{self.email}:{self.token}".encode()
            headers["Authorization"] = "Basic " + base64.b64encode(raw).decode()
        return headers

    def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        timeout = httpx.Timeout(
            connect=settings.HTTP_CONNECT_TIMEOUT,
            read=settings.HTTP_READ_TIMEOUT,
            write=settings.HTTP_READ_TIMEOUT,
            pool=settings.HTTP_CONNECT_TIMEOUT,
        )
        url = f"{self.base_url}{path}"
        try:
            with httpx.Client(timeout=timeout, follow_redirects=False) as client:
                resp = client.request(method, url, headers=self._headers(), **kwargs)
        except httpx.TimeoutException:
            raise JiraError(f"Jira 请求超时：{path}") from None
        except httpx.HTTPError as exc:
            raise JiraError(f"连不上 Jira：{type(exc).__name__}") from None

        if resp.status_code == 429:
            raise JiraError("Jira 限流（429），本次取数放弃，保留上次成功数据")
        if resp.status_code in (401, 403):
            raise JiraError(f"Jira 拒绝访问（HTTP {resp.status_code}）：凭证或权限不足")
        if resp.status_code >= 400:
            raise JiraError(f"Jira 返回 HTTP {resp.status_code}：{_redact(resp.text)[:200]}")
        try:
            return resp.json()
        except ValueError:
            raise JiraError("Jira 返回的不是合法 JSON") from None

    # ---- 对外 ----

    def verify_auth(self) -> str:
        """实测这套凭证能不能用，返回账号显示名。用真实 token 跑一次才算数。"""
        data = self._request("GET", "/rest/api/3/myself")
        return data.get("displayName") or data.get("emailAddress") or "(unknown)"

    def start_date_field(self) -> str:
        """发现「开始日期」自定义字段 id。

        字段显示名是本地化的（本站是「开始日期」），不能只按英文名猜；
        按字段类型 + 名称集合匹配，找不到就回退到常见的 customfield_10015 并如实记录。
        """
        if self._start_field:
            return self._start_field
        try:
            fields = self._request("GET", "/rest/api/3/field")
        except JiraError:
            self._start_field = "customfield_10015"
            return self._start_field
        wanted = {"start date", "开始日期", "起始日期"}
        datepicker = "com.atlassian.jira.plugin.system.customfieldtypes:datepicker"
        for f in fields if isinstance(fields, list) else []:
            schema = f.get("schema") or {}
            if schema.get("custom") == datepicker and str(f.get("name", "")).strip().lower() in wanted:
                self._start_field = f["id"]
                return self._start_field
        self._start_field = "customfield_10015"
        return self._start_field

    def search(self, jql: str, fields: list[str] | None = None) -> list[dict[str, Any]]:
        """enhanced search，翻完所有页。翻不完抛 JiraIncomplete。"""
        want = list(fields or DEFAULT_FIELDS)
        start_field = self.start_date_field()
        if start_field not in want:
            want.append(start_field)

        issues: list[dict[str, Any]] = []
        token: str | None = None
        for _ in range(MAX_PAGES):
            body: dict[str, Any] = {"jql": jql, "fields": want, "maxResults": PAGE_SIZE}
            if token:
                body["nextPageToken"] = token
            data = self._request("POST", "/rest/api/3/search/jql", json=body)
            page = data.get("issues")
            if not isinstance(page, list):
                raise JiraError("Jira 搜索响应缺少 issues 数组")
            issues.extend(page)
            token = data.get("nextPageToken")
            is_last = data.get("isLast")
            if is_last is True:
                return issues
            if token:
                continue
            # 没有下一页游标了。若上游同时明说 isLast=false，说明还有数据但我们
            # 拿不到——这是**取数不完整**，绝不能当成「就这么多」。
            if is_last is False:
                raise JiraIncomplete(
                    "Jira 声明还有更多结果（isLast=false）却没给 nextPageToken，"
                    "本次结果不完整，不替换上次成功数据")
            return issues
        raise JiraIncomplete(
            f"分页超过 {MAX_PAGES} 页仍未取完，本次结果不完整，不替换上次成功数据")
