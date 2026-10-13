"""
Session isolation unit and API contract tests.
"""

import asyncio
import json
import urllib.request
import urllib.error
import unittest
import websockets

from app.models.risk_scorer import risk_scorer
from app.main import (
    SessionManager,
    SessionState,
    SessionCapacityExceededError,
    app,
    session_manager,
)


class SessionIsolationTest(unittest.IsolatedAsyncioTestCase):
    BASE_URL = "http://127.0.0.1:8000"
    WS_URL = "ws://127.0.0.1:8000/ws/monitor"

    def _post_json(self, path: str, payload: dict) -> dict:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{self.BASE_URL}{path}",
            data=data,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _get_json(self, path: str) -> dict:
        req = urllib.request.Request(f"{self.BASE_URL}{path}")
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def test_risk_scorer_previous_score_does_not_mutate_singleton(self):
        """Passing previous_score to compute_score must not alter singleton self.last_score."""
        initial_singleton_score = risk_scorer.last_score

        features = {
            "scroll_speed": 1200,
            "session_duration": 110,
            "clicks_per_min": 35,
            "hour_of_day": 14,
            "pause_ratio": 0.1,
        }

        # Compute with explicit previous_score
        result = risk_scorer.compute_score(features, previous_score=10.0)
        self.assertGreater(result["score"], 10.0)

        # Singleton state must remain untouched
        self.assertEqual(risk_scorer.last_score, initial_singleton_score)

    def test_rest_session_isolation_risk_scoring(self):
        """Client A high-risk activity must not elevate Client B's smoothed risk score."""
        high_payload = {
            "scroll_speed": 1400.0,
            "session_duration": 110.0,
            "clicks_per_min": 38.0,
            "app_switch_rate": 2.0,
            "pause_ratio": 0.05,
        }
        res_a = self._post_json("/api/predict?session_id=iso_client_a", high_payload)
        score_a = res_a["risk"]["score"]

        # Client B sends low-risk behavior in a separate session
        low_payload = {
            "scroll_speed": 100.0,
            "session_duration": 15.0,
            "clicks_per_min": 5.0,
            "app_switch_rate": 5.0,
            "pause_ratio": 0.8,
        }
        res_b = self._post_json("/api/predict?session_id=iso_client_b", low_payload)
        score_b = res_b["risk"]["score"]

        # Score B must start from baseline 0.0 rather than being pulled toward Score A
        self.assertLess(score_b, 30.0)
        self.assertGreater(score_a, score_b)

    def test_session_history_isolation(self):
        """Interventions and telemetry in session A must not appear in session B."""
        # Trigger an intervention in session X
        payload = {
            "scroll_speed": 1400.0,
            "session_duration": 120.0,
            "clicks_per_min": 35.0,
            "app_switch_rate": 2.0,
            "pause_ratio": 0.05,
        }
        self._post_json("/api/intervene?session_id=user_iso_x", payload)

        hist_x = self._get_json("/api/history?session_id=user_iso_x")
        hist_y = self._get_json("/api/history?session_id=user_iso_y")

        self.assertGreaterEqual(len(hist_x["interventions"]), 1)
        self.assertEqual(len(hist_y["interventions"]), 0)

    def test_budget_mode_isolation(self):
        """Budget goal mode must be preserved independently across sessions."""
        self._post_json("/api/budget/mode?session_id=budget_user_1", {"goal_mode": "focus"})
        self._post_json("/api/budget/mode?session_id=budget_user_2", {"goal_mode": "casual"})

        stats_1 = self._get_json("/api/stats?session_id=budget_user_1")
        stats_2 = self._get_json("/api/stats?session_id=budget_user_2")

        self.assertEqual(stats_1["budget"]["goal_mode"], "focus")
        self.assertEqual(stats_1["budget"]["daily_limit_minutes"], 30)

        self.assertEqual(stats_2["budget"]["goal_mode"], "casual")
        self.assertEqual(stats_2["budget"]["daily_limit_minutes"], 120)

    def test_missing_session_id_defaults_to_shared_default(self):
        """Missing or empty session_id in REST requests consistently maps to the 'default' session."""
        payload = {
            "scroll_speed": 400.0,
            "session_duration": 60.0,
            "clicks_per_min": 10.0,
            "app_switch_rate": 3.0,
            "pause_ratio": 0.5,
        }
        # Post without session_id query param
        self._post_json("/api/intervene", payload)

        # GET history without session_id
        hist_default = self._get_json("/api/history")
        self.assertEqual(hist_default["session_id"], "default")
        self.assertGreaterEqual(len(hist_default["interventions"]), 1)

    async def test_rest_websocket_session_identity_consistency(self):
        """A client sending data via WebSocket populates history for that same session in REST."""
        session_id = "ws_rest_sync_session"
        async with websockets.connect(f"{self.WS_URL}?session_id={session_id}") as ws:
            ws_payload = {
                "scroll_speed": 1300.0,
                "session_duration": 180.0,
                "clicks_per_min": 32.0,
                "app_switch_rate": 3.0,
                "pause_ratio": 0.05,
            }
            await ws.send(json.dumps(ws_payload))
            raw_res = await asyncio.wait_for(ws.recv(), timeout=3.0)
            res = json.loads(raw_res)
            self.assertEqual(res["session_id"], session_id)

        # Now query REST history for the same session ID
        hist = self._get_json(f"/api/history?session_id={session_id}")
        self.assertEqual(hist["session_id"], session_id)
        self.assertGreaterEqual(len(hist["history"]), 1)
        self.assertEqual(hist["history"][-1]["risk_score"], res["risk"]["score"])

    async def test_websocket_missing_session_id_shares_default_with_rest(self):
        """WebSocket with no session_id routes to 'default', matching REST default history."""
        async with websockets.connect(self.WS_URL) as ws:
            ws_payload = {
                "scroll_speed": 500.0,
                "session_duration": 60.0,
                "clicks_per_min": 12.0,
                "app_switch_rate": 4.0,
                "pause_ratio": 0.4,
            }
            await ws.send(json.dumps(ws_payload))
            raw_res = await asyncio.wait_for(ws.recv(), timeout=3.0)
            res = json.loads(raw_res)
            self.assertEqual(res["session_id"], "default")

        # Query REST history with no session_id
        hist = self._get_json("/api/history")
        self.assertEqual(hist["session_id"], "default")

    def test_session_manager_lifecycle_and_eviction(self):
        """
        SessionManager LRU eviction bounds memory growth while protecting
        the 'default' session and any sessions with live active connections.
        """
        sm = SessionManager(max_sessions=3)
        # 1. Default session is always present
        s_default = sm.get_or_create(None)
        self.assertEqual(s_default.session_id, "default")

        # 2. Add two active sessions up to capacity (total 3: default, s1, s2)
        s1 = sm.get_or_create("s1")
        s2 = sm.get_or_create("s2")
        self.assertEqual(sm.get_session_count(), 3)

        # 3. Simulate s1 having an active WebSocket connection
        sm.register_connection("s1")
        self.assertEqual(s1.active_connections_count, 1)

        # 4. Request a new session s3 when capacity is full
        s3 = sm.get_or_create("s3")
        # s2 had 0 connections and was oldest inactive, so s2 must be evicted;
        # s1 has an active connection so it must NOT be evicted; default is never evicted.
        self.assertEqual(sm.get_session_count(), 3)
        self.assertIn("default", sm._sessions)
        self.assertIn("s1", sm._sessions)
        self.assertIn("s3", sm._sessions)
        self.assertNotIn("s2", sm._sessions)

        # 5. Clean up active connection
        sm.unregister_connection("s1")
        self.assertEqual(s1.active_connections_count, 0)

    def test_cross_session_trust_boundary_documentation(self):
        """
        Validates trust boundary: Session IDs isolate sessions by key, but are routing
        identifiers rather than cryptographic authentication credentials.
        """
        # Session A creates isolated data via intervention
        self._post_json("/api/intervene?session_id=trust_bound_a", {
            "scroll_speed": 1200.0, "session_duration": 120.0, "clicks_per_min": 30.0, "pause_ratio": 0.1
        })
        hist_b = self._get_json("/api/history?session_id=trust_bound_b")
        self.assertEqual(len(hist_b["interventions"]), 0)

        # Accessing session A with session_id=trust_bound_a retrieves session A's data
        # confirming that session_id is a cooperative routing identifier, not cryptographic auth.
        hist_a = self._get_json("/api/history?session_id=trust_bound_a")
        self.assertGreaterEqual(len(hist_a["interventions"]), 1)

    def test_per_session_rl_feedback_isolation(self):
        """
        Feedback submitted by Session A must mutate only Session A's personalized policy,
        leaving Session B's policy and the baseline policy untouched.
        """
        import uuid
        sid_a = f"user_rl_iso_a_{uuid.uuid4().hex[:8]}"
        sid_b = f"user_rl_iso_b_{uuid.uuid4().hex[:8]}"
        # Session A gets stats prior to feedback
        stats_a_pre = self._get_json(f"/api/stats?session_id={sid_a}")
        stats_b_pre = self._get_json(f"/api/stats?session_id={sid_b}")

        state_key = "high_neutral"
        action = "forced_break"
        pre_val_a = stats_a_pre["q_table"][state_key]["all_q"][action]
        pre_val_b = stats_b_pre["q_table"][state_key]["all_q"][action]
        self.assertEqual(pre_val_a, pre_val_b)

        # Session A submits positive feedback
        self._post_json(f"/api/feedback?session_id={sid_a}", {
            "intervention_type": action,
            "helpful": True,
            "risk_score_before": 80.0,
            "risk_score_after": 40.0,
        })

        # Query stats post-feedback
        stats_a_post = self._get_json(f"/api/stats?session_id={sid_a}")
        stats_b_post = self._get_json(f"/api/stats?session_id={sid_b}")

        post_val_a = stats_a_post["q_table"][state_key]["all_q"][action]
        post_val_b = stats_b_post["q_table"][state_key]["all_q"][action]

        # Session A's learned policy has been updated
        self.assertNotEqual(post_val_a, pre_val_a)
        # Session B's policy is completely unmodified and matches its baseline
        self.assertEqual(post_val_b, pre_val_b)

    def test_active_monitored_session_duration_accumulation(self):
        """
        Deterministic controllable clock test verifying server-observed monitored time accumulation,
        duplicate prevention, idle gap rejection, and disconnect pause/resume handling.
        """
        session = SessionState("test_time_tracking")

        # 1. First event starts window without prior delta
        acc = session.record_activity(timestamp=1000.0)
        self.assertEqual(acc, 0.0)
        self.assertEqual(session.accumulated_active_seconds, 0.0)

        # 2. Subsequent active event 15 seconds later within 60s idle threshold
        acc = session.record_activity(timestamp=1015.0)
        self.assertEqual(acc, 15.0)

        # 3. Duplicate event with identical timestamp does not double-count
        acc = session.record_activity(timestamp=1015.0)
        self.assertEqual(acc, 15.0)

        # 4. Another active event 20s later
        acc = session.record_activity(timestamp=1035.0)
        self.assertEqual(acc, 35.0)

        # 5. Idle pause gap: user is inactive for 120s (> 60s idle timeout)
        acc = session.record_activity(timestamp=1155.0)
        # Idle gap is rejected; window resumes without adding unobserved 120 seconds
        self.assertEqual(acc, 35.0)

        # 6. Active event 10s after resume adds 10s
        acc = session.record_activity(timestamp=1165.0)
        self.assertEqual(acc, 45.0)

        # 7. Disconnect pause
        session.pause_monitoring()
        self.assertFalse(session.activity_window_active)
        self.assertIsNone(session.last_activity_timestamp)

        # 8. Reconnect 500s later does not accumulate disconnected time
        acc = session.record_activity(timestamp=1665.0)
        self.assertEqual(acc, 45.0)

        # 9. Active stream continues
        acc = session.record_activity(timestamp=1675.0)
        self.assertEqual(acc, 55.0)

    def test_budget_clamping_and_exhaustion(self):
        """
        Budget calculations derive spent and remaining minutes accurately,
        clamp remaining minutes to zero when exhausted, and flag is_exhausted.
        """
        session = SessionState("test_budget_clamping")
        session.goal_mode = "recovery"  # 20 min limit

        # Initial state
        b0 = session.get_budget_summary()
        self.assertEqual(b0["daily_limit_minutes"], 20)
        self.assertEqual(b0["spent_minutes"], 0.0)
        self.assertEqual(b0["remaining_minutes"], 20.0)
        self.assertFalse(b0["is_exhausted"])

        # Accumulate 15 minutes (900 seconds)
        session.accumulated_active_seconds = 900.0
        b1 = session.get_budget_summary()
        self.assertEqual(b1["spent_minutes"], 15.0)
        self.assertEqual(b1["remaining_minutes"], 5.0)
        self.assertFalse(b1["is_exhausted"])

        # Accumulate 25 minutes (1500 seconds - exceeding 20m budget)
        session.accumulated_active_seconds = 1500.0
        b2 = session.get_budget_summary()
        self.assertEqual(b2["spent_minutes"], 25.0)
        self.assertEqual(b2["remaining_minutes"], 0.0)  # Clamped to zero
        self.assertTrue(b2["is_exhausted"])

    def test_out_of_order_and_rapid_event_interval_correctness(self):
        """
        Verify that out-of-order events do not pull timestamp backwards,
        preventing double-counting of overlapping intervals.
        """
        session = SessionState("test_ooo_events")

        # Event 1 at t=100.0
        session.record_activity(timestamp=100.0)
        self.assertEqual(session.accumulated_active_seconds, 0.0)
        self.assertEqual(session.last_activity_timestamp, 100.0)

        # Event 2 arriving out-of-order with earlier timestamp t=95.0
        session.record_activity(timestamp=95.0)
        self.assertEqual(session.accumulated_active_seconds, 0.0)
        # Timestamp must NOT be pulled backwards to 95.0!
        self.assertEqual(session.last_activity_timestamp, 100.0)

        # Event 3 at t=102.0
        session.record_activity(timestamp=102.0)
        # Delta must be 102.0 - 100.0 = 2.0s, NOT 102.0 - 95.0 = 7.0s!
        self.assertEqual(session.accumulated_active_seconds, 2.0)
        self.assertEqual(session.last_activity_timestamp, 102.0)

        # Rapid close event (e.g. REST + WebSocket concurrent telemetry) at t=102.3
        session.record_activity(timestamp=102.3)
        self.assertAlmostEqual(session.accumulated_active_seconds, 2.3, places=2)

    async def test_multi_connection_one_disconnects_monitoring_continues(self):
        """
        When two WebSocket connections share the same session ID and one disconnects,
        the session must NOT be paused while the other connection remains active.
        """
        session_id = "ws_dual_conn_test"
        ws1 = await websockets.connect(f"{self.WS_URL}?session_id={session_id}")
        ws2 = await websockets.connect(f"{self.WS_URL}?session_id={session_id}")

        try:
            # Client 1 sends telemetry
            payload = {
                "scroll_speed": 400.0,
                "session_duration": 60.0,
                "clicks_per_min": 10.0,
                "app_switch_rate": 3.0,
                "pause_ratio": 0.5,
            }
            await ws1.send(json.dumps(payload))
            await asyncio.wait_for(ws1.recv(), timeout=3.0)

            # Client 1 disconnects
            await ws1.close()

            # Client 2 is STILL active. Send telemetry from Client 2
            await ws2.send(json.dumps(payload))
            raw_res = await asyncio.wait_for(ws2.recv(), timeout=3.0)
            res = json.loads(raw_res)

            # Session must still be active and tracking
            self.assertEqual(res["session_id"], session_id)
            stats = self._get_json(f"/api/stats?session_id={session_id}")
            self.assertEqual(stats["session"]["session_id"], session_id)
            # Total readings must reflect both messages (not wiped or reset)
            self.assertGreaterEqual(stats["session"]["total_readings"], 2)

        finally:
            await ws2.close()

    def test_eviction_of_oldest_eligible_inactive_session(self):
        """
        Successful eviction of the oldest eligible inactive session:
        When capacity is full, get_or_create() must evict the least recently active
        inactive session (0 active connections, sid != 'default').
        """
        sm = SessionManager(max_sessions=3)
        self.assertEqual(sm.get_session_count(), 1)
        self.assertIn("default", sm._sessions)

        # Allocate s1 and s2 up to max capacity 3
        s1 = sm.get_or_create("s1")
        s2 = sm.get_or_create("s2")
        self.assertEqual(sm.get_session_count(), 3)

        # Touch s2 so s1 is strictly the oldest inactive session
        s2.touch()

        # Request new session s3: s1 must be evicted because it's the oldest inactive
        s3 = sm.get_or_create("s3")
        self.assertEqual(sm.get_session_count(), 3)
        self.assertNotIn("s1", sm._sessions)
        self.assertIn("s2", sm._sessions)
        self.assertIn("s3", sm._sessions)
        self.assertIn("default", sm._sessions)

    def test_rejection_when_full_and_all_non_default_sessions_have_active_connections(self):
        """
        Rejection when the session manager is full and all non-default sessions have active connections:
        Must raise SessionCapacityExceededError and never evict 'default' or sessions with live connections.
        """
        sm = SessionManager(max_sessions=3)
        s1 = sm.get_or_create("s1")
        s2 = sm.get_or_create("s2")
        self.assertEqual(sm.get_session_count(), 3)

        # Both non-default sessions have active connections
        sm.register_connection("s1")
        sm.register_connection("s2")
        self.assertEqual(s1.active_connections_count, 1)
        self.assertEqual(s2.active_connections_count, 1)

        # Attempt to create s3 must raise SessionCapacityExceededError
        with self.assertRaises(SessionCapacityExceededError):
            sm.get_or_create("s3")

        # Session count and existing sessions must remain completely intact
        self.assertEqual(sm.get_session_count(), 3)
        self.assertIn("default", sm._sessions)
        self.assertIn("s1", sm._sessions)
        self.assertIn("s2", sm._sessions)
        self.assertNotIn("s3", sm._sessions)

    def test_session_count_never_exceeds_configured_maximum(self):
        """
        The session count never exceeding the configured maximum:
        Under churn, eviction, and rejection attempts, total session count is hard-bounded.
        """
        max_limit = 4
        sm = SessionManager(max_sessions=max_limit)
        self.assertEqual(sm.get_session_count(), 1)

        # Fill to capacity
        for i in range(1, max_limit):
            sm.get_or_create(f"sess_{i}")
            self.assertLessEqual(sm.get_session_count(), max_limit)

        self.assertEqual(sm.get_session_count(), max_limit)

        # Continually add new inactive sessions; LRU eviction maintains exact capacity
        for i in range(max_limit, max_limit + 15):
            sm.get_or_create(f"sess_{i}")
            self.assertEqual(sm.get_session_count(), max_limit)
            self.assertIn("default", sm._sessions)

        # Lock all current non-default sessions with live connections
        for sid in list(sm._sessions.keys()):
            if sid != "default":
                sm.register_connection(sid)

        # Attempt to add further sessions; each must raise SessionCapacityExceededError
        for i in range(100, 110):
            with self.assertRaises(SessionCapacityExceededError):
                sm.get_or_create(f"overflow_{i}")
            self.assertEqual(sm.get_session_count(), max_limit)

    async def test_rest_endpoint_capacity_exhaustion_rejection(self):
        """
        Correct REST behavior when capacity is exhausted:
        Returns HTTP 503 capacity response without exposing stack traces or internal details.
        Existing sessions and default session remain accessible.
        """
        orig_max = session_manager.max_sessions
        orig_sessions = dict(session_manager._sessions)
        try:
            # Set hard capacity to 1 so only default session is permitted
            session_manager.max_sessions = 1
            session_manager._sessions = {"default": session_manager.default_session}

            async def asgi_post(url_path: str, body: dict):
                if "?" in url_path:
                    route_path, qs = url_path.split("?", 1)
                    qs_bytes = qs.encode("ascii")
                else:
                    route_path = url_path
                    qs_bytes = b""
                scope = {
                    "type": "http",
                    "method": "POST",
                    "path": route_path,
                    "raw_path": route_path.encode("ascii"),
                    "query_string": qs_bytes,
                    "headers": [(b"host", b"localhost"), (b"content-type", b"application/json")],
                }
                res_messages = []
                body_bytes = json.dumps(body).encode("utf-8")
                async def receive():
                    return {"type": "http.request", "body": body_bytes, "more_body": False}
                async def send(msg):
                    res_messages.append(msg)
                await app(scope, receive, send)
                start = next(m for m in res_messages if m["type"] == "http.response.start")
                body_content = b"".join(m.get("body", b"") for m in res_messages if m["type"] == "http.response.body")
                return start["status"], json.loads(body_content.decode("utf-8"))

            # 1. Requesting a new session when capacity is exhausted returns 503
            status, res = await asgi_post("/api/predict?session_id=new_client_overflow", {
                "scroll_speed": 400.0,
                "session_duration": 60.0,
                "clicks_per_min": 10.0,
            })
            self.assertEqual(status, 503)
            self.assertEqual(res.get("error"), "session_capacity_exceeded")
            self.assertIn("capacity", res.get("message", "").lower())
            # Must NOT expose stack traces or tracebacks
            self.assertNotIn("traceback", str(res).lower())
            self.assertNotIn("exception", str(res).lower())

            # 2. Existing / default session requests continue to work normally
            status_default, res_default = await asgi_post("/api/predict", {
                "scroll_speed": 400.0,
                "session_duration": 60.0,
                "clicks_per_min": 10.0,
            })
            self.assertEqual(status_default, 200)
            self.assertIn("prediction", res_default)

        finally:
            session_manager.max_sessions = orig_max
            session_manager._sessions = orig_sessions

    async def test_websocket_capacity_exhaustion_close_response(self):
        """
        Correct WebSocket behavior when capacity is exhausted:
        Returns clear error JSON and closes with code 1008 without exposing internal details.
        """
        orig_max = session_manager.max_sessions
        orig_sessions = dict(session_manager._sessions)
        try:
            # Set hard capacity to 1 so no new non-default session can be allocated
            session_manager.max_sessions = 1
            session_manager._sessions = {"default": session_manager.default_session}

            scope = {
                "type": "websocket",
                "path": "/ws/monitor",
                "raw_path": b"/ws/monitor",
                "query_string": b"session_id=ws_overflow_client",
                "headers": [(b"host", b"localhost")],
                "subprotocols": [],
            }
            sent_messages = []
            async def receive():
                return {"type": "websocket.connect"}
            async def send(msg):
                sent_messages.append(msg)

            await app(scope, receive, send)

            # Check messages: accept, error JSON send, close
            msg_types = [m["type"] for m in sent_messages]
            self.assertIn("websocket.accept", msg_types)
            self.assertIn("websocket.send", msg_types)
            self.assertIn("websocket.close", msg_types)

            # Check error message payload
            send_msg = next(m for m in sent_messages if m["type"] == "websocket.send")
            err_data = json.loads(send_msg.get("text", "{}"))
            self.assertEqual(err_data.get("type"), "error")
            self.assertEqual(err_data.get("error"), "session_capacity_exceeded")
            self.assertIn("capacity", err_data.get("message", "").lower())
            self.assertNotIn("traceback", str(err_data).lower())

            # Check close frame code
            close_msg = next(m for m in sent_messages if m["type"] == "websocket.close")
            self.assertEqual(close_msg.get("code"), 1008)

        finally:
            session_manager.max_sessions = orig_max
            session_manager._sessions = orig_sessions


if __name__ == "__main__":
    unittest.main()
