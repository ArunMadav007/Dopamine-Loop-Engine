# Frontend Integration Contract & Backend API Specification
**Project:** Dopamine Loop Disruption Engine (Anti-Addiction AI)  
**Document Location:** `dopamine-loop-engine/backend/FRONTEND_INTEGRATION_CONTRACT.md`  
**Target Audience:** Frontend Engineers (Dashboard & PWA) and Chrome Extension Developers  
**Backend Source File:** `dopamine-loop-engine/backend/app/main.py`  
**Status:** Verified against Phase 2.1 Backend Implementation

---

## 1. Overview & Architectural Trust Boundary

The Dopamine Loop Disruption Engine provides real-time behavioral analysis, addiction risk estimation, and reinforcement learning-driven interventions.

### Trust Boundary & Session Identity Convention
- **Session IDs (`session_id`)** in this engine serve as **routing and isolation identifiers** for multi-tab environments, browser extension instances, and local testing.
- **Authentication:** Session IDs are **not** cryptographic authentication tokens.
- **Default Fallback:** If `session_id` is omitted, `null`, or empty in REST query parameters or WebSocket query strings, the backend routes to the shared `"default"` session. This enables zero-configuration local operation where the frontend dashboard and the browser extension monitor the same stream out of the box.

---

## 2. Global Protocol & Network Requirements

### 2.1 Base URLs & Protocol Switching
| Environment | REST Protocol | REST Base URL | WebSocket Protocol | WebSocket URL |
| :--- | :--- | :--- | :--- | :--- |
| **Local Development** | `http://` | `http://127.0.0.1:8000` | `ws://` | `ws://127.0.0.1:8000/ws/monitor` |
| **Independent Production (e.g. Vercel)** | `https://` | `https://<backend-domain>` | `wss://` | `wss://<backend-domain>/ws/monitor` |

> [!IMPORTANT]
> **Mixed Content Constraint (Vercel / HTTPS Hosting):**
> Modern web browsers block unencrypted `http://` and `ws://` calls originating from an `https://` domain (e.g. Vercel deployment). When deploying the frontend independently on Vercel, the backend MUST be reachable over `https://` and `wss://`.
> The frontend application must use configurable environment variables rather than hardcoded URLs:
> - `NEXT_PUBLIC_API_BASE_URL` (or `window.__ENV__.API_BASE_URL`)
> - `NEXT_PUBLIC_WS_BASE_URL` (or `window.__ENV__.WS_BASE_URL`)

### 2.2 CORS Policy
The backend currently enables permissive CORS middleware (`main.py:34-40`):
- `allow_origins=["*"]`
- `allow_credentials=True`
- `allow_methods=["*"]`
- `allow_headers=["*"]`

All HTTP methods (`GET`, `POST`, `OPTIONS`) and custom headers are accepted from any frontend origin.

---

## 3. Real-Time WebSocket Contract

### 3.1 Endpoint & Connection Lifecycle
- **Endpoint:** `/ws/monitor`
- **Query Parameter:** `session_id` (optional, string)
  - Example: `ws://127.0.0.1:8000/ws/monitor?session_id=user_tab_42`
- **Multi-Connection Behavior:** Multiple WebSockets can attach to the same `session_id`. Each connection increments `session.active_connections_count`.
- **Disconnect Behavior:** When a client disconnects, `active_connections_count` is decremented. Active session monitoring is paused **only if** `active_connections_count == 0`. If a second tab remains open on the same session, tracking continues uninterrupted.

### 3.2 Incoming Message Schema (Client -> Backend)
The client must send text frames containing serialized JSON objects.

```json
{
  "scroll_speed": 450.0,
  "session_duration": 180.0,
  "clicks_per_min": 14.0,
  "app_switch_rate": 5.0,
  "hour_of_day": 14.5,
  "pause_ratio": 0.45
}
```

#### Field Specifications:
| Field | Type | Default if Omitted | Description |
| :--- | :--- | :--- | :--- |
| `scroll_speed` | `float` | `400.0` | Average pixels scrolled per second over rolling window. |
| `session_duration` | `float` | `180.0` | Client-reported elapsed active session duration in seconds. |
| `clicks_per_min` | `float` | `12.0` | Frequency of clicks/taps normalized to a 1-minute rate. |
| `app_switch_rate` | `float` | `5.0` | Frequency of context switches. (Provisional placeholder in web extensions). |
| `hour_of_day` | `float` or `null` | Server local time | Time of day in decimal hours (e.g. `23.5` = 23:30). If `null` or omitted, backend auto-fills with current server time. |
| `pause_ratio` | `float` | `0.5` | Ratio of stationary pause time vs active engagement ($0.0 \le r \le 1.0$). |

#### Error Responses on Incoming Frames:
- If JSON parsing fails: `{"type": "error", "message": "Invalid JSON format"}`
- If root JSON is not an object: `{"type": "error", "message": "Expected JSON object"}`

### 3.3 Outgoing Message Schema (Backend -> Client)
Sent **strictly to the originating WebSocket connection** (no broadcast privacy leak).

```json
{
  "type": "analysis",
  "session_id": "default",
  "prediction": {
    "prediction": 1,
    "state": "ADDICTIVE",
    "confidence": 0.94,
    "prob_normal": 0.06,
    "prob_addictive": 0.94
  },
  "risk": {
    "score": 78.4,
    "zone": "HIGH_RISK",
    "color": "#ff0044",
    "components": {
      "scroll_speed": 82.5,
      "session_duration": 91.0,
      "click_rate": 65.0,
      "time_factor": 45.0,
      "pause_inverse": 55.0
    },
    "weights": {
      "scroll_speed": 0.25,
      "session_duration": 0.25,
      "click_rate": 0.20,
      "time_factor": 0.15,
      "pause_inverse": 0.15
    }
  },
  "features": {
    "scroll_speed": 450.0,
    "session_duration": 180.0,
    "clicks_per_min": 14.0,
    "app_switch_rate": 5.0,
    "hour_of_day": 14.5,
    "pause_ratio": 0.45,
    "time_factor": 0.45,
    "dopamine_spike": 0.68,
    "session_intensity": 0.72,
    "scroll_speed_norm": 0.825,
    "session_duration_norm": 0.91,
    "click_rate_norm": 0.65
  },
  "intervention": {
    "action": "blur_screen",
    "name": "Screen Blur",
    "description": "Blurs screen content temporarily",
    "icon": "🌫️",
    "intensity": 3,
    "state": "high_neutral",
    "q_value": 0.8125
  },
  "session_stats": {
    "session_id": "default",
    "total_readings": 24,
    "total_interventions": 3,
    "responsiveness": "neutral",
    "accumulated_monitored_seconds": 72.0
  },
  "budget": {
    "goal_mode": "balanced",
    "daily_limit_minutes": 60,
    "spent_minutes": 1.2,
    "remaining_minutes": 58.8,
    "accumulated_monitored_seconds": 72.0,
    "usage_tracking": "active_monitored_session",
    "tracking_scope": "server_monitored_session_only",
    "is_exhausted": false,
    "updated_at": "2026-10-13T00:15:00.123456"
  },
  "timestamp": "2026-10-13T00:15:00.123456"
}
```

---

## 4. REST Endpoints Specification

### 4.1 System & Health

#### `GET /api/health`
- **Purpose:** Liveness & health probe.
- **Query Parameters:** None.
- **Request Body:** None.
- **Response Status:** `200 OK`
- **Response JSON:**
```json
{
  "status": "healthy",
  "engine": "Dopamine Loop Disruption Engine",
  "model_ready": true,
  "timestamp": "2026-10-13T00:15:00.123456"
}
```

---

### 4.2 Behavior Prediction & Risk Scoring

#### `POST /api/predict`
- **Purpose:** Classify behavioral data into `NORMAL` vs `ADDICTIVE` and compute risk score.
- **Query Parameters:** `session_id: Optional[str] = None`
- **Request Body:** `BehaviorData`
```json
{
  "scroll_speed": 400.0,
  "session_duration": 180.0,
  "clicks_per_min": 12.0,
  "app_switch_rate": 5.0,
  "hour_of_day": null,
  "pause_ratio": 0.5
}
```
- **Response Status:** `200 OK`
- **Response JSON:**
```json
{
  "prediction": {
    "prediction": 0,
    "state": "NORMAL",
    "confidence": 0.98,
    "prob_normal": 0.98,
    "prob_addictive": 0.02
  },
  "risk": {
    "score": 24.2,
    "zone": "SAFE",
    "color": "#00ff88",
    "components": {
      "scroll_speed": 24.1,
      "session_duration": 35.0,
      "click_rate": 26.3,
      "time_factor": 15.0,
      "pause_inverse": 50.0
    },
    "weights": {
      "scroll_speed": 0.25,
      "session_duration": 0.25,
      "click_rate": 0.20,
      "time_factor": 0.15,
      "pause_inverse": 0.15
    }
  },
  "features": { ... },
  "timestamp": "2026-10-13T00:15:00.123456"
}
```
- **Error Behavior:** `422 Unprocessable Content` if types are invalid.

#### `POST /api/risk-score`
- **Purpose:** Compute risk score and smoothed EMA breakdown without running the Random Forest classifier.
- **Query Parameters:** `session_id: Optional[str] = None`
- **Request Body:** `BehaviorData`
- **Response Status:** `200 OK`
- **Response JSON:**
```json
{
  "risk": {
    "score": 45.0,
    "zone": "WARNING",
    "color": "#ffaa00",
    "components": { ... },
    "weights": { ... }
  },
  "timestamp": "2026-10-13T00:15:00.123456"
}
```

---

### 4.3 Adaptive Interventions & Reinforcement Learning Feedback

#### `POST /api/intervene`
- **Purpose:** Evaluate behavior and select an intervention using the session's personalized Q-learning policy.
- **Query Parameters:** `session_id: Optional[str] = None`
- **Request Body:** `BehaviorData`
- **Response Status:** `200 OK`
- **Response JSON (Safe Condition — Score < 40):**
```json
{
  "risk": { "score": 25.0, "zone": "SAFE", "color": "#00ff88", ... },
  "intervention": {
    "action": "none",
    "name": "No Intervention",
    "description": "Risk level is low, no action needed",
    "icon": "✅",
    "intensity": 0,
    "state": "low_neutral",
    "q_value": 0
  },
  "timestamp": "2026-10-13T00:15:00.123456"
}
```
- **Response JSON (Elevated Condition — Score $\ge$ 40):**
```json
{
  "risk": { "score": 72.5, "zone": "HIGH_RISK", "color": "#ff0044", ... },
  "intervention": {
    "action": "grayscale",
    "name": "Grayscale Mode",
    "description": "Removes color saturation from the display",
    "icon": "🎨",
    "intensity": 1,
    "state": "high_neutral",
    "q_value": 0.725
  },
  "timestamp": "2026-10-13T00:15:00.123456"
}
```

#### `POST /api/feedback`
- **Purpose:** Submit user response to an intervention and adapt the session's personalized Q-table.
- **Query Parameters:** `session_id: Optional[str] = None`
- **Request Body:** `FeedbackData`
```json
{
  "intervention_type": "grayscale",
  "helpful": true,
  "risk_score_before": 72.5,
  "risk_score_after": 35.0
}
```
- **Response Status:** `200 OK`
- **Response JSON:**
```json
{
  "rl_update": {
    "status": "updated",
    "state": "high_neutral",
    "action": "grayscale",
    "reward": 1.0,
    "old_q": 0.725,
    "new_q": 0.7812,
    "epsilon": 0.1492
  },
  "responsiveness": "responsive",
  "feedback_count": 5
}
```
- **Special Statuses in `rl_update`:**
  - If `intervention_type == "none"`: `{"status": "noop", "action": "none"}`
  - If action is unknown: `{"status": "invalid_action"}`

---

### 4.4 Usage Budgets & Goal Modes

#### `POST /api/budget/mode`
- **Purpose:** Set the session's digital usage goal mode.
- **Query Parameters:** `session_id: Optional[str] = None`
- **Request Body:** `BudgetModeData`
```json
{
  "goal_mode": "balanced"
}
```
- **Supported `goal_mode` Values & Daily Limits:**
  - `"focus"`: 30 minutes
  - `"balanced"`: 60 minutes
  - `"recovery"`: 20 minutes
  - `"casual"`: 120 minutes
- **Response Status:** `200 OK`
- **Response JSON:**
```json
{
  "status": "success",
  "budget": {
    "goal_mode": "balanced",
    "daily_limit_minutes": 60,
    "spent_minutes": 14.5,
    "remaining_minutes": 45.5,
    "accumulated_monitored_seconds": 870.0,
    "usage_tracking": "active_monitored_session",
    "tracking_scope": "server_monitored_session_only",
    "is_exhausted": false,
    "updated_at": "2026-10-13T00:15:00.123456"
  }
}
```
- **Error Behavior:** `422 Unprocessable Content` if `goal_mode` is not one of the 4 literal values.

---

### 4.5 Statistics & History

#### `GET /api/stats`
- **Purpose:** Primary polling endpoint for dashboard cards, charts, budget summaries, insights, and model metadata.
- **Query Parameters:** `session_id: Optional[str] = None`
- **Response Status:** `200 OK`
- **Response JSON:**
```json
{
  "session": {
    "session_id": "default",
    "start": "2026-10-13T00:00:00.000000",
    "total_readings": 45,
    "total_interventions": 4,
    "total_feedback": 3,
    "responsiveness": "responsive",
    "accumulated_monitored_seconds": 870.0
  },
  "budget": {
    "goal_mode": "balanced",
    "daily_limit_minutes": 60,
    "spent_minutes": 14.5,
    "remaining_minutes": 45.5,
    "accumulated_monitored_seconds": 870.0,
    "usage_tracking": "active_monitored_session",
    "tracking_scope": "server_monitored_session_only",
    "is_exhausted": false,
    "updated_at": "2026-10-13T00:15:00.123456"
  },
  "insights": {
    "dominant_pattern": "normal",
    "recommendation": "Maintain balanced engagement with healthy pauses.",
    "is_evidence_based": false,
    "status": "placeholder_heuristic",
    "disclaimer": "Heuristic placeholders only; not evidence-based behavioral clinical findings."
  },
  "model": {
    "accuracy": null,
    "accuracy_status": "unavailable",
    "evaluation_dataset": null,
    "synthetic_benchmark": {
      "model_type": "RandomForestClassifier",
      "n_estimators": 100,
      "test_samples": 300,
      "synthetic_seed": 42,
      "accuracy": 1.0,
      "precision": 1.0,
      "recall": 1.0,
      "f1_score": 1.0,
      "roc_auc": 1.0,
      "evaluation_type": "synthetic_stratified_split",
      "disclaimer": "Metrics evaluated on synthetic test split only; does not represent clinical or real-world accuracy."
    },
    "feature_importance": {
      "scroll_speed": 0.2845,
      "session_duration": 0.2412,
      "clicks_per_min": 0.1984,
      "app_switch_rate": 0.0821,
      "hour_of_day": 0.0654,
      "pause_ratio": 0.1284
    }
  },
  "rl_agent": {
    "total_updates": 3,
    "epsilon": 0.1492,
    "avg_recent_reward": 1.0,
    "states_explored": 9,
    "recent_history": [
      {
        "state": "high_neutral",
        "action": "grayscale",
        "reward": 1.0,
        "old_q": 0.725,
        "new_q": 0.7812
      }
    ]
  },
  "q_table": {
    "low_responsive": {
      "best_action": "awareness_popup",
      "best_q": 0.7,
      "all_q": {
        "grayscale": 0.7,
        "delay": 0.2,
        "awareness_popup": 0.7,
        "blur_screen": 0.2,
        "forced_break": 0.2,
        "opportunity_cost": 0.2
      }
    }
  }
}
```

#### `GET /api/history`
- **Purpose:** History log for timeline charts and intervention breakdowns.
- **Query Parameters:** `session_id: Optional[str] = None`
- **Response Status:** `200 OK`
- **Response JSON:**
```json
{
  "session_id": "default",
  "history": [
    {
      "risk_score": 28.5,
      "zone": "SAFE",
      "state": "NORMAL",
      "confidence": 0.96,
      "timestamp": "2026-10-13T00:10:00.123456"
    }
  ],
  "interventions": [
    {
      "type": "grayscale",
      "risk_score": 75.2,
      "timestamp": "2026-10-13T00:12:00.123456"
    }
  ]
}
```

---

## 5. What Monitored-Session Time Actually Measures

> [!CAUTION]
> **Accurate Interpretation of Usage Metrics:**
> The timer represents **active telemetry monitored time**, NOT overall device or social-media usage.
> 
> 1. **Measurement Formula:** The backend tracks the delta $\Delta t = t_i - t_{i-1}$ between consecutive telemetry packets. If $0 < \Delta t \le 60\text{ seconds}$, $\Delta t$ is accrued to `accumulated_active_seconds`.
> 2. **Idle Window:** If no packet arrives for $> 60\text{ seconds}$, the session is considered paused/idle; no dead time is accrued.
> 3. **Non-Double Counting:** Out-of-order or duplicate packets ($\Delta t \le 0$) do not advance the timer or pull back the clock.
> 4. **No Device-Wide Visibility:** The server cannot observe other browser tabs, desktop software, or mobile applications.
> 5. **No Daily Reset:** The timer accumulates in volatile memory. There is currently **no automatic calendar midnight reset**. The timer resets only upon backend process restart or session eviction.

---

## 6. Provisional, Unavailable, and Placeholder Fields

The frontend must be resilient to provisional and placeholder values:

1. `model.accuracy`: **Always `null`** (with `accuracy_status: "unavailable"`). The frontend must not display `NaN` or format `null` as a percentage.
2. `model.evaluation_dataset`: **Always `null`**.
3. `insights`: Heuristic strings with `status: "placeholder_heuristic"` and `is_evidence_based: false`. Must be styled as informative tips, not clinical medical claims.
4. `app_switch_rate`: Browser security prevents extensions from reading tab-switching across non-permitted tabs. Default value `5.0` is used.
5. In-Memory Buffers: `history` holds the last 100 entries, and `interventions` holds the last 50 entries. They are volatile.

---

## 7. Current Frontend & Extension Consumption Audit

The repository contains existing clients consuming these endpoints. The table below documents their actual usage patterns and verified discrepancies:

| Client File | Target Endpoint / Protocol | Verified Line Numbers | Notes & Discrepancies |
| :--- | :--- | :--- | :--- |
| `frontend/sw.js` | Cache bypass on `/api/` & `/ws/` | Line 34 | Bypasses service-worker cache for dynamic calls. |
| `frontend/js/monitor.js` | `ws://<host>/ws/monitor` | Lines 115–120 | Hardcodes `window.location.host` with fallback to `localhost:8000`. Does not pass `?session_id=`. |
| `frontend/js/monitor.js` | `POST /api/feedback` | Lines 229–238 | Sends `intervention_type`, `helpful`, `risk_score_before`, `risk_score_after`. |
| `frontend/js/app.js` | `POST /api/budget/mode` | Lines 61–70 | Listens to `#setting-goal-mode`. *(Discrepancy: `#setting-goal-mode` does not exist in `index.html`).* |
| `frontend/js/app.js` | `GET /api/history` | Lines 81–93 | Feeds `updateSessionHistoryChart` and `updateEffectivenessChart`. |
| `frontend/js/app.js` | `GET /api/stats` | Lines 96–108, 118–140, 148–155 | Polled on load and every 10s. Calls `Dashboard.updateBudgetSummary` and `Dashboard.updateInsights`. *(Discrepancy: neither method is exported in `dashboard.js`).* |
| `extension/background.js` | `ws://127.0.0.1:8000/ws/monitor` | Line 13 | Hardcodes `ws://127.0.0.1:8000/ws/monitor`. Reconnects every 5s on close. |
| `extension/content.js` | Dispatches to background | Lines 81–97 | Sends rolling telemetry every 3 seconds to `background.js`. |

---

## 8. Compatibility Constraints for Frontend Development

When developing or rebuilding the frontend, maintain strict adherence to these rules:

1. **Preserve Exact Action Strings:**
   - `"none"`, `"grayscale"`, `"delay"`, `"awareness_popup"`, `"blur_screen"`, `"forced_break"`, `"opportunity_cost"`.
2. **Preserve Risk Zone Names & Color Keys:**
   - `"SAFE"` (`#00ff88`, $0 \le \text{score} < 30$)
   - `"WARNING"` (`#ffaa00`, $30 \le \text{score} < 70$)
   - `"HIGH_RISK"` (`#ff0044`, $70 \le \text{score} \le 100$)
3. **Preserve Supported Goal Modes:**
   - `"focus"`, `"balanced"`, `"recovery"`, `"casual"`.
4. **Do Not Hardcode `127.0.0.1:8000`:**
   - Use dynamic environment variables so the frontend can deploy to Vercel and connect to any backend origin.
5. **Handle Missing DOM Bindings Gracefully:**
   - When importing legacy modules (`dashboard.js`, `app.js`), ensure `updateBudgetSummary` and `updateInsights` are either implemented or guarded against runtime `TypeError`.
6. **Graceful Handling of Null Accuracy:**
   - Always check `stats.model.accuracy !== null` before rendering model metrics. If null, display `accuracy_status: "unavailable"` or show the synthetic benchmark metrics with their required disclaimer.
