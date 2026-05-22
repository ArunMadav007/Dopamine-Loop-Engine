# Dopamine Loop Disruption Engine

A full-stack AI-assisted behavior-monitoring project that detects addictive scrolling patterns and triggers adaptive interventions in real time.

## Tech Stack
- Frontend: Vanilla JS, HTML, CSS (PWA-enabled)
- Backend: FastAPI + WebSocket
- ML/RL: scikit-learn + Q-learning policy

## Project Structure
- `frontend/`: PWA dashboard and monitoring UI
- `backend/`: FastAPI APIs, websocket loop, model code
- `extension/`: Browser extension scripts

## Local Run
1. Install Python dependencies:
   - `cd backend`
   - `py -m pip install -r requirements.txt`
2. Start the API server:
   - `py -m uvicorn app.main:app --host 127.0.0.1 --port 8000`
3. Open:
   - `http://127.0.0.1:8000`

## Key Endpoints
- `GET /`: frontend app
- `POST /api/predict`: behavior prediction and risk scoring
- `POST /api/intervene`: recommended intervention
- `POST /api/feedback`: RL feedback update
- `WS /ws/monitor`: real-time monitoring stream

## GitHub Push
From repository root:

```powershell
git init
git add .
git commit -m "Initial commit: UI/UX revamp + project setup"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

If the remote already exists, skip `git remote add origin ...` and run:

```powershell
git remote -v
git push -u origin main
```
