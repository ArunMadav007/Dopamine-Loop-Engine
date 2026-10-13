"""
Two-client WebSocket privacy leak regression tests and connection resilience tests.
"""

import asyncio
import json
import unittest
import websockets


class WebSocketPrivacyRegressionTest(unittest.IsolatedAsyncioTestCase):
    WS_URL = "ws://127.0.0.1:8000/ws/monitor"

    async def test_two_clients_privacy_isolation(self):
        """
        REGRESSION TEST FOR P0 PRIVACY LEAK:
        When Client 1 sends telemetry, ONLY Client 1 should receive the analysis.
        Client 2 must NOT receive Client 1's telemetry or analysis via broadcast.
        """
        async with websockets.connect(f"{self.WS_URL}?session_id=user_alpha") as ws1, \
                   websockets.connect(f"{self.WS_URL}?session_id=user_beta") as ws2:

            payload_1 = {
                "scroll_speed": 1250.0,
                "session_duration": 180.0,
                "clicks_per_min": 28.0,
                "app_switch_rate": 3.0,
                "pause_ratio": 0.15,
            }

            # Client 1 sends telemetry
            await ws1.send(json.dumps(payload_1))

            # Client 1 must receive its analysis
            raw_res1 = await asyncio.wait_for(ws1.recv(), timeout=3.0)
            res1 = json.loads(raw_res1)
            self.assertEqual(res1.get("type"), "analysis")
            self.assertEqual(res1.get("session_id"), "user_alpha")
            self.assertEqual(res1["features"]["scroll_speed"], 1250.0)

            # Client 2 MUST NOT receive any broadcast of Client 1's data
            with self.assertRaises(asyncio.TimeoutError):
                await asyncio.wait_for(ws2.recv(), timeout=1.5)

    async def test_single_client_telemetry_flow(self):
        """Verify normal telemetry streaming, feature extraction, and intervention response."""
        import uuid
        session_id = f"user_test_flow_{uuid.uuid4().hex[:8]}"
        async with websockets.connect(f"{self.WS_URL}?session_id={session_id}") as ws:
            payload = {
                "scroll_speed": 350.0,
                "session_duration": 60.0,
                "clicks_per_min": 8.0,
                "app_switch_rate": 4.0,
                "pause_ratio": 0.6,
            }
            await ws.send(json.dumps(payload))

            raw_res = await asyncio.wait_for(ws.recv(), timeout=3.0)
            res = json.loads(raw_res)

            self.assertEqual(res.get("type"), "analysis")
            self.assertEqual(res.get("session_id"), session_id)
            self.assertIn("prediction", res)
            self.assertIn("risk", res)
            self.assertIn("features", res)
            self.assertIn("intervention", res)
            self.assertIn("session_stats", res)
            self.assertEqual(res["session_stats"]["session_id"], session_id)
            self.assertEqual(res["session_stats"]["total_readings"], 1)

    async def test_malformed_json_graceful_handling(self):
        """Verify server responds with error message without closing connection upon malformed JSON."""
        async with websockets.connect(self.WS_URL) as ws:
            # Send non-JSON text
            await ws.send("NOT_A_VALID_JSON")
            raw_res = await asyncio.wait_for(ws.recv(), timeout=3.0)
            res = json.loads(raw_res)
            self.assertEqual(res.get("type"), "error")
            self.assertIn("Invalid JSON", res.get("message", ""))

            # Follow up with valid data to verify socket is still alive and operational
            valid_payload = {
                "scroll_speed": 400.0,
                "session_duration": 30.0,
                "clicks_per_min": 10.0,
                "app_switch_rate": 2.0,
                "pause_ratio": 0.5,
            }
            await ws.send(json.dumps(valid_payload))
            valid_res = json.loads(await asyncio.wait_for(ws.recv(), timeout=3.0))
            self.assertEqual(valid_res.get("type"), "analysis")

    async def test_client_disconnect_cleanup(self):
        """Verify rapid connect and disconnect does not raise unhandled exceptions."""
        ws = await websockets.connect(self.WS_URL)
        await ws.close()
        # Verify a new connection succeeds immediately after disconnect
        async with websockets.connect(self.WS_URL) as ws2:
            self.assertTrue(ws2.state.name in ("OPEN", "CONNECTING"))


if __name__ == "__main__":
    unittest.main()
