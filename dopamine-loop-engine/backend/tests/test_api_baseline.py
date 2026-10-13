"""
Baseline API contract and static file route tests.
"""

import json
import urllib.request
import urllib.error
import unittest


class ApiBaselineContractTest(unittest.TestCase):
    BASE_URL = "http://127.0.0.1:8000"

    def _post_json(self, path: str, payload: dict) -> dict:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{self.BASE_URL}{path}",
            data=data,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _post_json_status(self, path: str, payload: dict):
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{self.BASE_URL}{path}",
            data=data,
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read().decode("utf-8"))

    def _get_json(self, path: str) -> dict:
        req = urllib.request.Request(f"{self.BASE_URL}{path}")
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _get_raw(self, path: str):
        req = urllib.request.Request(f"{self.BASE_URL}{path}")
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.headers.get_content_type(), resp.read()

    def test_health_check(self):
        """GET /api/health returns healthy status and engine name."""
        data = self._get_json("/api/health")
        self.assertEqual(data.get("status"), "healthy")
        self.assertEqual(data.get("engine"), "Dopamine Loop Disruption Engine")
        self.assertTrue(data.get("model_ready"))

    def test_predict_endpoint(self):
        """POST /api/predict returns model prediction, risk score, and feature map."""
        payload = {
            "scroll_speed": 450.0,
            "session_duration": 90.0,
            "clicks_per_min": 14.0,
            "app_switch_rate": 4.0,
            "pause_ratio": 0.45,
        }
        res = self._post_json("/api/predict", payload)
        self.assertIn("prediction", res)
        self.assertIn("state", res["prediction"])
        self.assertIn("risk", res)
        self.assertIn("score", res["risk"])
        self.assertIn("features", res)

    def test_risk_score_endpoint(self):
        """POST /api/risk-score returns risk score and zone."""
        payload = {
            "scroll_speed": 200.0,
            "session_duration": 30.0,
            "clicks_per_min": 5.0,
            "app_switch_rate": 2.0,
            "pause_ratio": 0.8,
        }
        res = self._post_json("/api/risk-score", payload)
        self.assertIn("risk", res)
        self.assertIn("score", res["risk"])
        self.assertIn("zone", res["risk"])
        self.assertIn(res["risk"]["zone"], ("SAFE", "WARNING", "HIGH_RISK"))

    def test_intervene_endpoint(self):
        """POST /api/intervene returns recommended action details."""
        payload = {
            "scroll_speed": 950.0,
            "session_duration": 120.0,
            "clicks_per_min": 25.0,
            "app_switch_rate": 2.0,
            "pause_ratio": 0.2,
        }
        res = self._post_json("/api/intervene", payload)
        self.assertIn("intervention", res)
        self.assertIn("action", res["intervention"])
        self.assertIn("name", res["intervention"])

    def test_feedback_endpoint(self):
        """POST /api/feedback records user response and updates policy."""
        payload = {
            "intervention_type": "awareness_popup",
            "helpful": True,
            "risk_score_before": 72.0,
            "risk_score_after": 45.0,
        }
        res = self._post_json("/api/feedback", payload)
        self.assertIn("rl_update", res)
        self.assertIn("responsiveness", res)
        self.assertGreaterEqual(res.get("feedback_count", 0), 1)

    def test_budget_mode_endpoint(self):
        """POST /api/budget/mode sets supported goal mode and returns active monitored budget."""
        # Supported mode: focus (30m)
        res_focus = self._post_json("/api/budget/mode", {"goal_mode": "focus"})
        self.assertEqual(res_focus.get("status"), "success")
        self.assertEqual(res_focus["budget"]["goal_mode"], "focus")
        self.assertEqual(res_focus["budget"]["daily_limit_minutes"], 30)
        self.assertIsInstance(res_focus["budget"]["remaining_minutes"], (int, float))
        self.assertIsInstance(res_focus["budget"]["spent_minutes"], (int, float))
        self.assertEqual(res_focus["budget"]["usage_tracking"], "active_monitored_session")
        self.assertEqual(res_focus["budget"]["tracking_scope"], "server_monitored_session_only")

        # Supported mode: casual (120m)
        res_casual = self._post_json("/api/budget/mode", {"goal_mode": "casual"})
        self.assertEqual(res_casual["budget"]["daily_limit_minutes"], 120)

        # Supported mode: recovery (20m)
        res_rec = self._post_json("/api/budget/mode", {"goal_mode": "recovery"})
        self.assertEqual(res_rec["budget"]["daily_limit_minutes"], 20)

        # Supported mode: balanced (60m)
        res_bal = self._post_json("/api/budget/mode", {"goal_mode": "balanced"})
        self.assertEqual(res_bal["budget"]["daily_limit_minutes"], 60)

        # Unsupported mode must be rejected with 422 Unprocessable Entity
        status_code, _ = self._post_json_status("/api/budget/mode", {"goal_mode": "mindful"})
        self.assertEqual(status_code, 422)

    def test_stats_endpoint_contract(self):
        """GET /api/stats returns all fields required by dashboard frontend with honest metadata."""
        res = self._get_json("/api/stats")
        self.assertIn("session", res)
        self.assertIn("budget", res)
        self.assertIn("insights", res)
        self.assertIn("model", res)
        self.assertIn("rl_agent", res)
        self.assertIn("q_table", res)

        # Ensure budget fields required by Dashboard.updateBudgetSummary are present
        self.assertIn("goal_mode", res["budget"])
        self.assertIn("daily_limit_minutes", res["budget"])
        self.assertIsInstance(res["budget"]["remaining_minutes"], (int, float))
        self.assertIsInstance(res["budget"]["spent_minutes"], (int, float))
        self.assertEqual(res["budget"]["usage_tracking"], "active_monitored_session")
        self.assertEqual(res["budget"]["tracking_scope"], "server_monitored_session_only")

        # Insights must be labeled honestly as heuristic placeholders
        self.assertFalse(res["insights"]["is_evidence_based"])
        self.assertEqual(res["insights"]["status"], "placeholder_heuristic")

        # Model accuracy must not be invented if unverified, but synthetic benchmark is available
        self.assertIsNone(res["model"]["accuracy"])
        self.assertEqual(res["model"]["accuracy_status"], "unavailable")
        self.assertIsNotNone(res["model"]["synthetic_benchmark"])
        self.assertTrue(res["model"]["synthetic_benchmark"]["is_synthetic"])

    def test_history_endpoint(self):
        """GET /api/history returns history array and interventions array."""
        res = self._get_json("/api/history")
        self.assertIn("history", res)
        self.assertIn("interventions", res)
        self.assertIsInstance(res["history"], list)
        self.assertIsInstance(res["interventions"], list)

    def test_static_routes_serve_assets(self):
        """Static asset routes must return 200 OK with correct MIME types."""
        status_root, mime_root, body_root = self._get_raw("/")
        self.assertEqual(status_root, 200)
        self.assertIn("text/html", mime_root)
        self.assertIn(b"Dopamine Loop Disruption Engine", body_root)

        status_css, mime_css, body_css = self._get_raw("/css/style.css")
        self.assertEqual(status_css, 200)
        self.assertIn("text/css", mime_css)
        self.assertGreater(len(body_css), 100)

        status_js, mime_js, body_js = self._get_raw("/js/app.js")
        self.assertEqual(status_js, 200)
        self.assertIn("javascript", mime_js)
        self.assertGreater(len(body_js), 100)

        status_sw, mime_sw, _ = self._get_raw("/sw.js")
        self.assertEqual(status_sw, 200)
        self.assertIn("javascript", mime_sw)

        status_mf, mime_mf, _ = self._get_raw("/manifest.json")
        self.assertEqual(status_mf, 200)
        self.assertIn("json", mime_mf)


if __name__ == "__main__":
    unittest.main()
