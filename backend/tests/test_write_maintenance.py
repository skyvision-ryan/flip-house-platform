"""Drain a real in-flight ASGI write, preserve reads, and keep the barrier across restart."""
import asyncio
from pathlib import Path
import sys
import tempfile
import unittest
from starlette.responses import Response
from app.maintenance import WriteBarrier

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from write_maintenance import enter


class WriteMaintenanceTests(unittest.IsolatedAsyncioTestCase):
    async def test_drain_and_restart_block_all_write_methods_including_upload(self):
        with tempfile.TemporaryDirectory() as temp:
            data = Path(temp)
            started = asyncio.Event(); release = asyncio.Event()
            async def app(scope, receive, send):
                if scope["method"] == "POST":
                    started.set(); await release.wait()
                    (data / "upload.txt").write_text("Complete synthetic upload")
                await Response(status_code=204)(scope, receive, send)
            guarded = WriteBarrier(app, data)
            async def request(instance, method):
                messages = []
                async def send(message): messages.append(message)
                async def receive(): return {"type": "http.request", "body": b""}
                await instance({"type": "http", "method": method}, receive, send)
                return messages[0]["status"]
            inflight = asyncio.create_task(request(guarded, "POST"))
            await asyncio.wait_for(started.wait(), 2)
            drain = asyncio.create_task(asyncio.to_thread(enter, data, 2))
            for _ in range(100):
                if (data / "WRITE_MAINTENANCE").exists(): break
                await asyncio.sleep(0.005)
            self.assertFalse(drain.done())
            for method in ("POST", "PATCH", "PUT", "DELETE"):
                self.assertEqual(await request(guarded, method), 503)
            self.assertEqual(await request(guarded, "GET"), 204)
            self.assertFalse((data / "upload.txt").exists())
            release.set()
            self.assertEqual(await inflight, 204)
            self.assertTrue((await drain)["in_flight_writes_drained"])
            self.assertEqual((data / "upload.txt").read_text(), "Complete synthetic upload")
            restarted = WriteBarrier(app, data)
            self.assertEqual(await request(restarted, "POST"), 503)
            self.assertEqual(await request(restarted, "GET"), 204)
            (data / "WRITE_MAINTENANCE").unlink()
            self.assertEqual(await request(restarted, "POST"), 204)
