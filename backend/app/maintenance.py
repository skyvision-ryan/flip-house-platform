"""Persistent write barrier. Shared request locks let maintenance drain in-flight writes."""
import asyncio
import fcntl
import os
from pathlib import Path

from starlette.responses import JSONResponse
from .settings import DATA_DIR


class WriteBarrier:
    def __init__(self, app, data_dir=DATA_DIR):
        self.app = app
        self.data_dir = Path(data_dir)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] in {"GET", "HEAD", "OPTIONS"}:
            return await self.app(scope, receive, send)
        marker = self.data_dir / "WRITE_MAINTENANCE"
        async def unavailable():
            return await JSONResponse({"detail": "Maintenance in progress", "message_code": "server.maintenance",
                                       "message_params": {}}, status_code=503, headers={"Retry-After": "60"})(scope, receive, send)
        if marker.exists():
            return await unavailable()
        fd = os.open(self.data_dir / "write-barrier.lock", os.O_CREAT | os.O_RDWR, 0o600)
        try:
            while True:
                try:
                    fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    await asyncio.sleep(0.01)
            # Maintenance may begin between the initial check and lock acquisition.
            if marker.exists():
                return await unavailable()
            # Hold the lock through response/background completion, including file writes.
            await self.app(scope, receive, send)
        finally:
            os.close(fd)
