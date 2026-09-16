"""上次成功快照 + 单飞刷新。

三条规则，都被测试盯着：
1. **只有结构完好的新快照才替换上次成功快照**（validate_integrity 通过）。
   排期冲突不算结构损坏——那是业务事实，照常展示。
2. **并发刷新合并成一次**上游请求。多人同时打开不会重复轰炸 Jira。
3. **刷新永远在后台线程里跑**，请求线程不等它。没有缓存时页面先出加载页再轮询，
   不做长时间同步阻塞。

限制：这些状态都在进程内存里，只保证**单实例 / 单 worker** 的行为。
多实例部署需要换成共享存储，见 README。
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any, Callable

from . import settings
from .contract import FETCH_OK, Snapshot, validate_integrity

log = logging.getLogger("vp_report.store")

STATUS_OK = "ok"                  # 有数据且新鲜
STATUS_STALE = "stale"            # 有数据但最近一次更新失败
STATUS_LOADING = "loading"        # 还没有任何数据，正在取
STATUS_UNAVAILABLE = "unavailable"  # 还没有任何数据，且取数失败


class SnapshotStore:
    def __init__(self, fetcher: Callable[[], Snapshot]) -> None:
        self._fetcher = fetcher
        self._lock = threading.Lock()
        self._snapshot: Snapshot | None = None
        self._fetched_at: float | None = None      # 最后一次**成功**同步的时刻
        self._last_error: str | None = None
        self._refreshing = False
        self._last_started: float = 0.0
        self._attempted = False                    # 有没有试过至少一次

    # ---- 查询 ----

    def status(self) -> str:
        with self._lock:
            return self._status_locked()

    def state(self) -> dict[str, Any]:
        """给 /api/report/data 用的完整状态。"""
        with self._lock:
            snap = self._snapshot
            return {
                "status": self._status_locked(),
                "snapshot": snap.to_dict() if snap else None,
                # 成功同步时间来自快照本身，不是页面生成时间
                "fetched_at": snap.fetched_at if snap else None,
                "last_error": self._last_error,
                "refreshing": self._refreshing,
            }

    def _status_locked(self) -> str:
        if self._snapshot is not None:
            return STATUS_STALE if self._last_error else STATUS_OK
        if self._refreshing or not self._attempted:
            return STATUS_LOADING
        return STATUS_UNAVAILABLE

    # ---- 刷新 ----

    def _is_fresh(self) -> bool:
        return (
            self._snapshot is not None
            and self._fetched_at is not None
            and (time.monotonic() - self._fetched_at) < settings.CACHE_TTL_SECONDS
        )

    def ensure_fresh(self, manual: bool = False) -> bool:
        """需要就在后台起一次刷新。**立即返回**，不等结果。

        返回值：这次调用有没有真的触发刷新。
        manual=True 是用户点了刷新按钮——仍受冷却约束，登录用户也不能无限触发。
        """
        with self._lock:
            if self._refreshing:
                return False
            now = time.monotonic()
            if manual:
                if now - self._last_started < settings.MANUAL_REFRESH_COOLDOWN:
                    return False
            elif self._is_fresh():
                return False
            elif self._last_error and now - self._last_started < settings.RETRY_COOLDOWN_SECONDS:
                # 刚失败过就别每次打开都再打一次 Jira。上游挂着的时候，
                # 页面应该稳定停在「暂不可用」，而不是反复跳回「正在同步」。
                return False
            self._refreshing = True
            self._last_started = now

        thread = threading.Thread(target=self._run_refresh, name="vp-report-refresh", daemon=True)
        thread.start()
        return True

    def _run_refresh(self) -> None:
        error: str | None = None
        snap: Snapshot | None = None
        try:
            candidate = self._fetcher()
            # 结构完好才替换。排期冲突不在这一关。
            validate_integrity(candidate)
            # 只有**完整**的快照才上位。partial（有 fetch_errors，例如某一类记录
            # 没取到）会让页面少一整块内容，拿它盖掉上次完整数据是倒退。
            if candidate.fetch_status != FETCH_OK:
                raise RuntimeError(
                    "取数不完整（" + "；".join(candidate.fetch_errors or ["未记录原因"])
                    + "），保留上次成功快照")
            snap = candidate
        except Exception as exc:                       # noqa: BLE001 - 上游什么都可能抛
            error = f"{type(exc).__name__}: {exc}"
            log.warning("报告取数失败，保留上次成功快照：%s", error)

        with self._lock:
            self._attempted = True
            self._refreshing = False
            if snap is not None:
                self._snapshot = snap
                self._fetched_at = time.monotonic()
                self._last_error = None
            else:
                self._last_error = error

    # ---- 测试用 ----

    def refresh_blocking(self) -> None:
        """同步跑一次刷新。只给测试用，生产路径不调用。"""
        with self._lock:
            self._refreshing = True
            self._last_started = time.monotonic()
        self._run_refresh()
