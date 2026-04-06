"""
Dopamine Loop Disruption Engine — FastAPI Backend
Main application with REST + WebSocket endpoints.
"""

import os
import json
import asyncio
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.models.behavior_model import behavior_model
from app.models.risk_scorer import risk_scorer
from app.models.rl_agent import rl_agent
from app.data.feature_engine import extract_features, raw_to_model_input

# ──────────────────────────────────────────
# App initialization
# ──────────────────────────────────────────

app = FastAPI(
    title="Dopamine Loop Disruption Engine",
    description="AI-powered anti-addiction system with real-time behavior detection and adaptive interventions",
    version="1.0.0",
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


# ──────────────────────────────────────────
# Session state (in-memory for hackathon)
# ──────────────────────────────────────────

session_data = {
    "history": [],         # List of risk score readings
    "interventions": [],   # List of interventions triggered
    "feedback": [],        # User feedback on interventions
    "session_start": datetime.now().isoformat(),
    "total_sessions": 0,
    "total_interventions": 0,
    "responsiveness": "neutral",  # Updated based on feedback
}


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


# ──────────────────────────────────────────
# REST API endpoints
# ──────────────────────────────────────────

@app.post("/api/predict")
async def predict_behavior(data: BehaviorData):
    """Predict behavior state (NORMAL vs ADDICTIVE) from behavioral data."""
    if data.hour_of_day is None:
        data.hour_of_day = datetime.now().hour + datetime.now().minute / 60.0

    raw_data = data.model_dump()
    features = extract_features(raw_data)
    model_input = raw_to_model_input(raw_data)
    prediction = behavior_model.predict(model_input)
    risk = risk_scorer.compute_score(raw_data)

    return {
        "prediction": prediction,
        "risk": risk,
        "features": features,
        "timestamp": datetime.now().isoformat(),
    }


@app.post("/api/risk-score")
async def get_risk_score(data: BehaviorData):
    """Calculate addiction risk score."""
    if data.hour_of_day is None:
        data.hour_of_day = datetime.now().hour + datetime.now().minute / 60.0

    raw_data = data.model_dump()
    risk = risk_scorer.compute_score(raw_data)

    return {
        "risk": risk,
        "timestamp": datetime.now().isoformat(),
    }


@app.post("/api/intervene")
async def get_intervention(data: BehaviorData):
    """Get recommended intervention based on current behavior."""
    if data.hour_of_day is None:
        data.hour_of_day = datetime.now().hour + datetime.now().minute / 60.0

    raw_data = data.model_dump()
    risk = risk_scorer.compute_score(raw_data)
    intervention = rl_agent.select_action(
        risk["score"], session_data["responsiveness"]
    )

    # Record intervention
    session_data["interventions"].append({
        "type": intervention["action"],
        "risk_score": risk["score"],
        "timestamp": datetime.now().isoformat(),
    })
    session_data["total_interventions"] += 1

    return {
        "risk": risk,
        "intervention": intervention,
        "timestamp": datetime.now().isoformat(),
    }


@app.post("/api/feedback")
async def submit_feedback(data: FeedbackData):
    """Submit user feedback on an intervention and update RL agent."""
    reward = 1.0 if data.helpful else -1.0

    # Update RL agent
    update_result = rl_agent.update(
        risk_score=data.risk_score_before,
        action=data.intervention_type,
        reward=reward,
        next_risk_score=data.risk_score_after,
        responsiveness=session_data["responsiveness"],
    )

    # Update responsiveness based on feedback pattern
    session_data["feedback"].append({
        "type": data.intervention_type,
        "helpful": data.helpful,
        "timestamp": datetime.now().isoformat(),
    })

    # Compute responsiveness from recent feedback
    recent_feedback = session_data["feedback"][-10:]
    if recent_feedback:
        helpful_ratio = sum(1 for f in recent_feedback if f["helpful"]) / len(recent_feedback)
        if helpful_ratio > 0.6:
            session_data["responsiveness"] = "responsive"
        elif helpful_ratio < 0.3:
            session_data["responsiveness"] = "resistant"
        else:
            session_data["responsiveness"] = "neutral"

    # Save RL agent periodically
    if len(session_data["feedback"]) % 5 == 0:
        rl_agent.save()

    return {
        "rl_update": update_result,
        "responsiveness": session_data["responsiveness"],
        "feedback_count": len(session_data["feedback"]),
    }


@app.get("/api/stats")
async def get_stats():
    """Get session statistics and model info."""
    return {
        "session": {
            "start": session_data["session_start"],
            "total_readings": len(session_data["history"]),
            "total_interventions": session_data["total_interventions"],
            "total_feedback": len(session_data["feedback"]),
            "responsiveness": session_data["responsiveness"],
        },
        "model": {
            "accuracy": behavior_model.accuracy,
            "feature_importance": behavior_model.get_feature_importance(),
        },
        "rl_agent": rl_agent.get_stats(),
        "q_table": rl_agent.get_q_table_summary(),
    }


@app.get("/api/history")
async def get_history():
    """Get session history (last 100 readings)."""
    return {
        "history": session_data["history"][-100:],
        "interventions": session_data["interventions"][-50:],
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
        self.active_connections.remove(websocket)
        print(f"[WS] Client disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass


ws_manager = ConnectionManager()


@app.websocket("/ws/monitor")
async def websocket_monitor(websocket: WebSocket):
    """Real-time behavioral monitoring WebSocket."""
    await ws_manager.connect(websocket)

    try:
        while True:
            # Receive behavioral data from client
            data = await websocket.receive_json()

            # Auto-fill time if not provided
            if "hour_of_day" not in data or data["hour_of_day"] is None:
                now = datetime.now()
                data["hour_of_day"] = now.hour + now.minute / 60.0

            # Process through full pipeline
            features = extract_features(data)
            model_input = raw_to_model_input(data)
            prediction = behavior_model.predict(model_input)
            risk = risk_scorer.compute_score(data)

            # Get intervention recommendation
            intervention = rl_agent.select_action(
                risk["score"], session_data["responsiveness"]
            )

            # Store in history
            reading = {
                "risk_score": risk["score"],
                "zone": risk["zone"],
                "state": prediction["state"],
                "confidence": prediction["confidence"],
                "timestamp": datetime.now().isoformat(),
            }
            session_data["history"].append(reading)

            # Send response back
            response = {
                "type": "analysis",
                "prediction": prediction,
                "risk": risk,
                "features": features,
                "intervention": intervention,
                "session_stats": {
                    "total_readings": len(session_data["history"]),
                    "total_interventions": session_data["total_interventions"],
                    "responsiveness": session_data["responsiveness"],
                },
                "timestamp": datetime.now().isoformat(),
            }

            await ws_manager.broadcast(response)

    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:
        import sys, traceback
        print(f"[WS] Error: {e}")
        traceback.print_exc()
        sys.stdout.flush()
        ws_manager.disconnect(websocket)


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
