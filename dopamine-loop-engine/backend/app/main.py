"""
Dopamine Loop Disruption Engine — FastAPI Backend
Main application with REST + WebSocket endpoints.
"""

import os
import json
import time
import asyncio
from datetime import datetime
from typing import Dict, List, Optional, Literal, Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from app.models.behavior_model import behavior_model
from app.models.risk_scorer import risk_scorer
from app.models.rl_agent import rl_agent
from app.data.feature_engine import extract_features, raw_to_model_input

class SessionCapacityExceededError(Exception):
    """
    Raised when SessionManager reaches max_sessions and cannot allocate a new session
    because no eligible inactive non-default session is available for eviction.
    """
    pass


# ──────────────────────────────────────────
# App initialization
# ──────────────────────────────────────────

app = FastAPI(
    title="Dopamine Loop Disruption Engine",
    description="AI-powered anti-addiction system with real-time behavior detection and adaptive interventions",
    version="1.0.0",
)

@app.exception_handler(SessionCapacityExceededError)
async def session_capacity_exception_handler(request: Request, exc: SessionCapacityExceededError):
    return JSONResponse(
        status_code=503,
        content={
            "error": "session_capacity_exceeded",
            "message": "Maximum active session capacity has been reached. Please try again later.",
            "detail": "Session capacity reached. Maximum active sessions exceeded.",
        },
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve frontend static files
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "frontend")
if os.path.exists(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
    css_dir = os.path.join(FRONTEND_DIR, "css")
    js_dir = os.path.join(FRONTEND_DIR, "js")
    assets_dir = os.path.join(FRONTEND_DIR, "assets")
    if os.path.exists(css_dir):
        app.mount("/css", StaticFiles(directory=css_dir), name="css")
    if os.path.exists(js_dir):
        app.mount("/js", StaticFiles(directory=js_dir), name="js")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")


# ──────────────────────────────────────────
# Session state & bounded isolation lifecycle
# ──────────────────────────────────────────

class SessionState:
    """Encapsulates per-client state to isolate telemetry, risk, interventions, and active usage."""

    def __init__(self, session_id: str, baseline_agent: Optional[Any] = None):
        self.session_id = session_id
        self.history: List[dict] = []
        self.interventions: List[dict] = []
        self.feedback: List[dict] = []
        self.session_start = datetime.now().isoformat()
        self.total_interventions = 0
        self.responsiveness = "neutral"
        self.last_risk_score = 0.0
        self.goal_mode = "balanced"
        self.last_active = datetime.now()
        self.active_connections_count = 0

        # Decision 1: Per-session personalized RL policy seeded from read-only baseline
        agent_to_copy = baseline_agent if baseline_agent is not None else rl_agent
        self.rl_agent = agent_to_copy.create_personalized_copy()

        # Decision 3: Server-side active monitored session duration tracking
        self.accumulated_active_seconds: float = 0.0
        self.last_activity_timestamp: Optional[float] = None
        self.activity_window_active: bool = False
        self.idle_timeout_seconds: float = 60.0

    def touch(self):
        self.last_active = datetime.now()

    def record_activity(self, timestamp: Optional[float] = None) -> float:
        """
        Accumulate server-observed active monitored duration.

        If timestamp is omitted, uses server time.time().
        Calculates delta from last activity timestamp:
        - If first activity or elapsed delta > idle_timeout_seconds:
          Window resumes; no unobserved gap is accumulated.
        - If 0 < delta <= idle_timeout_seconds:
          delta is added to accumulated_active_seconds.
        - If delta <= 0:
          duplicate or clock skew, 0 added.
        Returns current accumulated_active_seconds.
        """
        now = time.time() if timestamp is None else float(timestamp)
        self.touch()
        self.activity_window_active = True

        if self.last_activity_timestamp is not None:
            delta = now - self.last_activity_timestamp
            if 0 < delta <= self.idle_timeout_seconds:
                self.accumulated_active_seconds += delta
            # Monotonically advance to prevent out-of-order events from double-counting intervals
            if now > self.last_activity_timestamp:
                self.last_activity_timestamp = now
        else:
            self.last_activity_timestamp = now

        return self.accumulated_active_seconds

    def pause_monitoring(self):
        """
        Pause active monitored accumulation (e.g. on WebSocket disconnect or client pause).
        Prevents unobserved disconnect time from being accumulated upon reconnect.
        """
        self.activity_window_active = False
        self.last_activity_timestamp = None

    def get_budget_summary(self) -> dict:
        """
        Compute spent and remaining minutes from actual server-accumulated monitored time.
        Clamps remaining time to zero when budget is exhausted.
        """
        limit_mins = BUDGET_LIMITS.get(self.goal_mode, 60)
        spent_mins = round(self.accumulated_active_seconds / 60.0, 1)
        remaining_mins = max(0.0, round(limit_mins - spent_mins, 1))
        return {
            "goal_mode": self.goal_mode,
            "daily_limit_minutes": limit_mins,
            "spent_minutes": spent_mins,
            "remaining_minutes": remaining_mins,
            "accumulated_monitored_seconds": round(self.accumulated_active_seconds, 1),
            "usage_tracking": "active_monitored_session",
            "tracking_scope": "server_monitored_session_only",
            "is_exhausted": remaining_mins <= 0.0,
            "updated_at": datetime.now().isoformat(),
        }

    def add_reading(self, reading: dict, max_len: int = 100):
        self.touch()
        self.history.append(reading)
        if len(self.history) > max_len:
            self.history.pop(0)

    def add_intervention(self, intervention_record: dict, max_len: int = 50):
        self.touch()
        self.interventions.append(intervention_record)
        self.total_interventions += 1
        if len(self.interventions) > max_len:
            self.interventions.pop(0)

    def add_feedback(self, feedback_record: dict):
        self.touch()
        self.feedback.append(feedback_record)
        recent_feedback = self.feedback[-10:]
        if recent_feedback:
            helpful_ratio = sum(1 for f in recent_feedback if f["helpful"]) / len(recent_feedback)
            if helpful_ratio > 0.6:
                self.responsiveness = "responsive"
            elif helpful_ratio < 0.3:
                self.responsiveness = "resistant"
            else:
                self.responsiveness = "neutral"

    def to_dict(self) -> dict:
        return {
            "session_id": self.session_id,
            "start": self.session_start,
            "total_readings": len(self.history),
            "total_interventions": self.total_interventions,
            "total_feedback": len(self.feedback),
            "responsiveness": self.responsiveness,
            "goal_mode": self.goal_mode,
            "accumulated_active_seconds": round(self.accumulated_active_seconds, 1),
        }


class SessionManager:
    """
    Manages active sessions with clean lifecycle, LRU eviction, and trust boundary documentation.

    TRUST BOUNDARY & SESSION IDENTITY:
    - Session IDs in this architecture serve as routing/separation identifiers for local
      demonstration, test harness isolation, and multi-tab scenarios.
    - They are NOT cryptographic authentication tokens or authorization credentials.
    - Missing or omitted session IDs consistently map to the shared local 'default' session,
      allowing the frontend dashboard and browser extension to share a single unified session
      out-of-the-box without requiring authentication setup.
    """

    def __init__(self, max_sessions: int = 100, baseline_agent: Optional[Any] = None):
        self.max_sessions = max(1, max_sessions)
        self.baseline_agent = baseline_agent or rl_agent
        self._sessions: Dict[str, SessionState] = {}
        self._default_session = SessionState("default", self.baseline_agent)
        self._sessions["default"] = self._default_session

    def get_or_create(self, session_id: Optional[str] = None) -> SessionState:
        # Explicit documented fallback: missing/empty session_id maps to default
        if not session_id or session_id.strip() == "":
            self._default_session.touch()
            return self._default_session

        clean_id = session_id.strip()
        if clean_id in self._sessions:
            session = self._sessions[clean_id]
            session.touch()
            return session

        # Evict oldest inactive session if capacity reached
        while len(self._sessions) >= self.max_sessions:
            evicted = self._evict_oldest_inactive()
            if not evicted:
                break

        if len(self._sessions) >= self.max_sessions:
            raise SessionCapacityExceededError(
                f"Maximum session capacity reached ({self.max_sessions}). Cannot allocate session '{clean_id}'."
            )

        session = SessionState(clean_id, self.baseline_agent)
        self._sessions[clean_id] = session
        return session

    def register_connection(self, session_id: str):
        if session_id in self._sessions:
            self._sessions[session_id].active_connections_count += 1
            self._sessions[session_id].touch()

    def unregister_connection(self, session_id: str):
        if session_id in self._sessions:
            self._sessions[session_id].active_connections_count = max(
                0, self._sessions[session_id].active_connections_count - 1
            )
            self._sessions[session_id].touch()

    def _evict_oldest_inactive(self) -> bool:
        """
        Evict the least recently active session that has no live connections and is not 'default'.
        Returns True if an eligible session was evicted, False otherwise.
        """
        candidates = [
            s for sid, s in self._sessions.items()
            if sid != "default" and s.active_connections_count == 0
        ]
        if candidates:
            oldest = min(candidates, key=lambda s: s.last_active)
            del self._sessions[oldest.session_id]
            return True
        return False

    @property
    def default_session(self) -> SessionState:
        self._default_session.touch()
        return self._default_session

    def get_session_count(self) -> int:
        return len(self._sessions)


session_manager = SessionManager(max_sessions=100)


# Backward compatibility proxy dictionary for legacy single-session access
class SessionDataProxy(dict):
    @property
    def session(self) -> SessionState:
        return session_manager.default_session

    def __getitem__(self, key):
        s = self.session
        mapping = {
            "history": s.history,
            "interventions": s.interventions,
            "feedback": s.feedback,
            "session_start": s.session_start,
            "total_interventions": s.total_interventions,
            "responsiveness": s.responsiveness,
            "goal_mode": s.goal_mode,
        }
        if key in mapping:
            return mapping[key]
        return super().get(key)

    def __setitem__(self, key, value):
        s = self.session
        if key == "responsiveness":
            s.responsiveness = value
        elif key == "total_interventions":
            s.total_interventions = value
        elif key == "goal_mode":
            s.goal_mode = value
        super().__setitem__(key, value)


session_data = SessionDataProxy({
    "history": session_manager.default_session.history,
    "interventions": session_manager.default_session.interventions,
    "feedback": session_manager.default_session.feedback,
    "session_start": session_manager.default_session.session_start,
    "total_sessions": 1,
    "total_interventions": 0,
    "responsiveness": "neutral",
})


# ──────────────────────────────────────────
# Additional Pydantic models & constants
# ──────────────────────────────────────────

GoalMode = Literal["focus", "balanced", "recovery", "casual"]

BUDGET_LIMITS: Dict[str, int] = {
    "focus": 30,
    "balanced": 60,
    "recovery": 20,
    "casual": 120,
}

class BudgetModeData(BaseModel):
    goal_mode: GoalMode


# ──────────────────────────────────────────
# Pydantic models
# ──────────────────────────────────────────

class BehaviorData(BaseModel):
    scroll_speed: float = 400.0
    session_duration: float = 180.0
    clicks_per_min: float = 12.0
    app_switch_rate: float = 5.0
    hour_of_day: Optional[float] = None
    pause_ratio: float = 0.5


class FeedbackData(BaseModel):
    intervention_type: str
    helpful: bool  # True = helped, False = ignored/annoyed
    risk_score_before: float
    risk_score_after: float


# ──────────────────────────────────────────
# Startup event
# ──────────────────────────────────────────

@app.on_event("startup")
async def startup():
    """Initialize ML model and RL agent on startup."""
    print("=" * 60)
    print("[BRAIN] DOPAMINE LOOP DISRUPTION ENGINE -- Starting up...")
    print("=" * 60)

    # Train or load behavior model
    result = behavior_model.train()
    print(f"[STARTUP] Model: {result['status']}")

    # Load or initialize RL agent
    loaded = rl_agent.load()
    if not loaded:
        print("[STARTUP] RL Agent: initialized with defaults")
    else:
        print("[STARTUP] RL Agent: loaded from disk")

    print("=" * 60)
    print("[READY] Engine ready! Visit http://localhost:8000")
    print("=" * 60)


# ──────────────────────────────────────────
# Frontend routes
# ──────────────────────────────────────────

@app.get("/")
async def serve_frontend():
    """Serve the frontend PWA."""
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "Frontend not found. Place files in /frontend/"}


@app.get("/sw.js")
async def serve_sw():
    """Serve the service worker at root scope."""
    sw_path = os.path.join(FRONTEND_DIR, "sw.js")
    if os.path.exists(sw_path):
        return FileResponse(sw_path, media_type="application/javascript")
    return {"error": "sw.js not found"}


@app.get("/manifest.json")
async def serve_manifest():
    """Serve PWA manifest at root scope."""
    manifest_path = os.path.join(FRONTEND_DIR, "manifest.json")
    if os.path.exists(manifest_path):
        return FileResponse(manifest_path, media_type="application/json")
    return {"error": "manifest.json not found"}


# ──────────────────────────────────────────
# REST API endpoints
# ──────────────────────────────────────────

@app.post("/api/predict")
async def predict_behavior(data: BehaviorData, session_id: Optional[str] = None):
    """Predict behavior state (NORMAL vs ADDICTIVE) from behavioral data."""
    if data.hour_of_day is None:
        data.hour_of_day = datetime.now().hour + datetime.now().minute / 60.0

    session = session_manager.get_or_create(session_id)
    session.record_activity()
    raw_data = data.model_dump()
    features = extract_features(raw_data)
    model_input = raw_to_model_input(raw_data)
    prediction = behavior_model.predict(model_input)
    risk = risk_scorer.compute_score(raw_data, previous_score=session.last_risk_score)
    session.last_risk_score = risk["score"]

    return {
        "prediction": prediction,
        "risk": risk,
        "features": features,
        "timestamp": datetime.now().isoformat(),
    }


@app.post("/api/risk-score")
async def get_risk_score(data: BehaviorData, session_id: Optional[str] = None):
    """Calculate addiction risk score."""
    if data.hour_of_day is None:
        data.hour_of_day = datetime.now().hour + datetime.now().minute / 60.0

    session = session_manager.get_or_create(session_id)
    session.record_activity()
    raw_data = data.model_dump()
    risk = risk_scorer.compute_score(raw_data, previous_score=session.last_risk_score)
    session.last_risk_score = risk["score"]

    return {
        "risk": risk,
        "timestamp": datetime.now().isoformat(),
    }


@app.post("/api/intervene")
async def get_intervention(data: BehaviorData, session_id: Optional[str] = None):
    """Get recommended intervention based on current behavior using session's personalized policy."""
    if data.hour_of_day is None:
        data.hour_of_day = datetime.now().hour + datetime.now().minute / 60.0

    session = session_manager.get_or_create(session_id)
    session.record_activity()
    raw_data = data.model_dump()
    risk = risk_scorer.compute_score(raw_data, previous_score=session.last_risk_score)
    session.last_risk_score = risk["score"]
    intervention = session.rl_agent.select_action(
        risk["score"], session.responsiveness
    )

    # Record intervention in session
    session.add_intervention({
        "type": intervention["action"],
        "risk_score": risk["score"],
        "timestamp": datetime.now().isoformat(),
    })

    return {
        "risk": risk,
        "intervention": intervention,
        "timestamp": datetime.now().isoformat(),
    }


@app.post("/api/feedback")
async def submit_feedback(data: FeedbackData, session_id: Optional[str] = None):
    """Submit user feedback on an intervention and update session's personalized RL policy."""
    session = session_manager.get_or_create(session_id)
    session.record_activity()
    reward = 1.0 if data.helpful else -1.0

    # If action is "none", acknowledge gracefully
    if data.intervention_type == "none":
        update_result = {"status": "noop", "action": "none"}
    else:
        # Decision 1: Updates strictly target session.rl_agent without altering other sessions or disk baseline
        update_result = session.rl_agent.update(
            risk_score=data.risk_score_before,
            action=data.intervention_type,
            reward=reward,
            next_risk_score=data.risk_score_after,
            responsiveness=session.responsiveness,
        )

    # Update session feedback and responsiveness
    session.add_feedback({
        "type": data.intervention_type,
        "helpful": data.helpful,
        "timestamp": datetime.now().isoformat(),
    })

    return {
        "rl_update": update_result,
        "responsiveness": session.responsiveness,
        "feedback_count": len(session.feedback),
    }


@app.post("/api/budget/mode")
async def set_budget_mode(data: BudgetModeData, session_id: Optional[str] = None):
    """Set user digital usage goal mode."""
    session = session_manager.get_or_create(session_id)
    session.goal_mode = data.goal_mode
    return {
        "status": "success",
        "budget": session.get_budget_summary(),
    }


@app.get("/api/stats")
async def get_stats(session_id: Optional[str] = None):
    """Get session statistics, budget, insights, and model info."""
    session = session_manager.get_or_create(session_id)
    return {
        "session": {
            "session_id": session.session_id,
            "start": session.session_start,
            "total_readings": len(session.history),
            "total_interventions": session.total_interventions,
            "total_feedback": len(session.feedback),
            "responsiveness": session.responsiveness,
            "accumulated_monitored_seconds": round(session.accumulated_active_seconds, 1),
        },
        "budget": session.get_budget_summary(),
        "insights": {
            "dominant_pattern": "normal" if session.last_risk_score < 50 else "elevated",
            "recommendation": "Maintain balanced engagement with healthy pauses.",
            "is_evidence_based": False,
            "status": "placeholder_heuristic",
            "disclaimer": "Heuristic placeholders only; not evidence-based behavioral clinical findings.",
        },
        "model": {
            "accuracy": behavior_model.accuracy,
            "accuracy_status": "unavailable" if behavior_model.accuracy is None else "verified",
            "evaluation_dataset": None,
            "synthetic_benchmark": behavior_model.get_benchmark_summary(),
            "feature_importance": behavior_model.get_feature_importance(),
        },
        "rl_agent": session.rl_agent.get_stats(),
        "q_table": session.rl_agent.get_q_table_summary(),
    }


@app.get("/api/history")
async def get_history(session_id: Optional[str] = None):
    """Get session history (last 100 readings)."""
    session = session_manager.get_or_create(session_id)
    return {
        "session_id": session.session_id,
        "history": session.history[-100:],
        "interventions": session.interventions[-50:],
    }


# ──────────────────────────────────────────
# WebSocket for real-time monitoring
# ──────────────────────────────────────────

class ConnectionManager:
    """Manages WebSocket connections."""

    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f"[WS] Client connected. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            print(f"[WS] Client disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                pass


ws_manager = ConnectionManager()


@app.websocket("/ws/monitor")
async def websocket_monitor(websocket: WebSocket):
    """Real-time behavioral monitoring WebSocket with isolated per-client sessions."""
    # Resolve session: missing/empty session_id defaults to shared default session
    client_session_id = websocket.query_params.get("session_id")
    try:
        session = session_manager.get_or_create(client_session_id)
    except SessionCapacityExceededError:
        await websocket.accept()
        await websocket.send_json({
            "type": "error",
            "error": "session_capacity_exceeded",
            "message": "Maximum active session capacity has been reached. Please try again later.",
        })
        await websocket.close(code=1008, reason="Session capacity reached")
        return

    await ws_manager.connect(websocket)
    session_manager.register_connection(session.session_id)

    try:
        while True:
            # Receive behavioral data from client
            raw_data = await websocket.receive_text()
            try:
                data = json.loads(raw_data)
            except Exception:
                await websocket.send_json({"type": "error", "message": "Invalid JSON format"})
                continue

            if not isinstance(data, dict):
                await websocket.send_json({"type": "error", "message": "Expected JSON object"})
                continue

            # Auto-fill time if not provided
            if "hour_of_day" not in data or data["hour_of_day"] is None:
                now = datetime.now()
                data["hour_of_day"] = now.hour + now.minute / 60.0

            # Accumulate active monitored session time
            session.record_activity()

            # Process through full pipeline with session-isolated risk scoring
            features = extract_features(data)
            model_input = raw_to_model_input(data)
            prediction = behavior_model.predict(model_input)
            risk = risk_scorer.compute_score(data, previous_score=session.last_risk_score)
            session.last_risk_score = risk["score"]

            # Get intervention recommendation based on session's personalized policy
            intervention = session.rl_agent.select_action(
                risk["score"], session.responsiveness
            )

            # Store in session history
            reading = {
                "risk_score": risk["score"],
                "zone": risk["zone"],
                "state": prediction["state"],
                "confidence": prediction["confidence"],
                "timestamp": datetime.now().isoformat(),
            }
            session.add_reading(reading)

            if intervention.get("action") != "none":
                session.add_intervention({
                    "type": intervention["action"],
                    "risk_score": risk["score"],
                    "timestamp": datetime.now().isoformat(),
                })

            # Send response back ONLY to the requesting client (NO BROADCAST PRIVACY LEAK)
            response = {
                "type": "analysis",
                "session_id": session.session_id,
                "prediction": prediction,
                "risk": risk,
                "features": features,
                "intervention": intervention,
                "session_stats": {
                    "session_id": session.session_id,
                    "total_readings": len(session.history),
                    "total_interventions": session.total_interventions,
                    "responsiveness": session.responsiveness,
                    "accumulated_monitored_seconds": round(session.accumulated_active_seconds, 1),
                },
                "budget": session.get_budget_summary(),
                "timestamp": datetime.now().isoformat(),
            }

            await websocket.send_json(response)

    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:
        import sys, traceback
        print(f"[WS] Error: {e}")
        traceback.print_exc()
        sys.stdout.flush()
        ws_manager.disconnect(websocket)
    finally:
        session_manager.unregister_connection(session.session_id)
        # Only pause monitoring if no other live connections remain for this session
        if session.active_connections_count == 0:
            session.pause_monitoring()


# ──────────────────────────────────────────
# Health check
# ──────────────────────────────────────────

@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "engine": "Dopamine Loop Disruption Engine",
        "model_ready": behavior_model.is_trained,
        "timestamp": datetime.now().isoformat(),
    }
