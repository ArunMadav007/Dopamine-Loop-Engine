"""
Reinforcement Learning Intervention Agent for Dopamine Loop Disruption Engine.
Q-Learning agent that learns optimal interventions for each user state.
"""

import os
import json
import random
import copy
import numpy as np
from typing import Dict, List, Tuple, Optional

QTABLE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "saved_models")
QTABLE_PATH = os.path.join(QTABLE_DIR, "q_table.json")


class RLInterventionAgent:
    """
    Q-Learning agent that selects adaptive interventions.
    
    States: risk_level (low/medium/high) × responsiveness (responsive/neutral/resistant)
    Actions: grayscale, delay, awareness_popup, blur_screen, forced_break
    Rewards: +1 if user reduces scrolling, -1 if ignored, 0 if neutral
    """

    ACTIONS = [
        "grayscale",
        "delay",
        "awareness_popup",
        "blur_screen",
        "forced_break",
        "opportunity_cost",
    ]

    ACTION_DETAILS = {
        "grayscale": {
            "name": "Grayscale Mode",
            "description": "Screen turns grayscale to reduce visual appeal",
            "icon": "🎨",
            "intensity": 1,
        },
        "delay": {
            "name": "Artificial Delay",
            "description": "Brief loading delay before content appears",
            "icon": "⏳",
            "intensity": 2,
        },
        "awareness_popup": {
            "name": "Awareness Prompt",
            "description": "Friendly reminder about your screen time",
            "icon": "💬",
            "intensity": 1,
        },
        "blur_screen": {
            "name": "Screen Blur",
            "description": "Screen blurs momentarily to break focus",
            "icon": "🔕",
            "intensity": 3,
        },
        "forced_break": {
            "name": "Break Suggestion",
            "description": "Suggests taking a break with countdown",
            "icon": "📴",
            "intensity": 4,
        },
        "opportunity_cost": {
            "name": "Perspective Shift",
            "description": "Shows what you could have accomplished instead",
            "icon": "💡",
            "intensity": 2,
        },
    }

    RISK_LEVELS = ["low", "medium", "high"]
    RESPONSIVENESS = ["responsive", "neutral", "resistant"]

    def __init__(
        self,
        alpha: float = 0.1,
        gamma: float = 0.9,
        epsilon: float = 0.15,
        initial_q_table: Optional[Dict[str, Dict[str, float]]] = None,
        max_history: int = 100,
        is_read_only: bool = False,
    ):
        self.alpha = alpha        # Learning rate
        self.gamma = gamma        # Discount factor
        self.epsilon = epsilon    # Exploration rate
        self.max_history = max_history
        self.is_read_only = is_read_only
        self.history: List[Dict] = []
        self.q_table: Dict[str, Dict[str, float]] = {}
        if initial_q_table is not None:
            self.q_table = copy.deepcopy(initial_q_table)
        else:
            self._initialize_q_table()

    def create_personalized_copy(self) -> "RLInterventionAgent":
        """
        Create an isolated, personalized RL agent seeded from this policy.
        Mutations on the returned agent do not affect this baseline instance.
        """
        return RLInterventionAgent(
            alpha=self.alpha,
            gamma=self.gamma,
            epsilon=self.epsilon,
            initial_q_table=copy.deepcopy(self.q_table),
            max_history=self.max_history,
            is_read_only=False,
        )

    def _initialize_q_table(self):
        """Initialize Q-table with smart defaults."""
        for risk in self.RISK_LEVELS:
            for resp in self.RESPONSIVENESS:
                state_key = f"{risk}_{resp}"
                self.q_table[state_key] = {}
                for action in self.ACTIONS:
                    # Set reasonable initial values based on domain knowledge
                    if risk == "low":
                        # Low risk: prefer gentle interventions
                        if action in ("awareness_popup", "grayscale"):
                            self.q_table[state_key][action] = 0.6
                        else:
                            self.q_table[state_key][action] = 0.2
                    elif risk == "medium":
                        # Medium risk: balanced
                        if action in ("delay", "awareness_popup"):
                            self.q_table[state_key][action] = 0.7
                        elif action == "blur_screen":
                            self.q_table[state_key][action] = 0.5
                        else:
                            self.q_table[state_key][action] = 0.3
                    else:
                        # High risk: prefer strong interventions
                        if action in ("forced_break", "blur_screen"):
                            self.q_table[state_key][action] = 0.8
                        elif action == "delay":
                            self.q_table[state_key][action] = 0.6
                        else:
                            self.q_table[state_key][action] = 0.4

                    # Adjust for responsiveness
                    if resp == "resistant":
                        # Resistant users need stronger push
                        if action in ("forced_break", "blur_screen"):
                            self.q_table[state_key][action] += 0.1
                    elif resp == "responsive":
                        # Responsive users work with gentle nudges
                        if action in ("awareness_popup", "grayscale"):
                            self.q_table[state_key][action] += 0.1

    def _get_risk_level(self, risk_score: float) -> str:
        """Convert numeric risk score to categorical level."""
        if risk_score < 30:
            return "low"
        elif risk_score < 70:
            return "medium"
        else:
            return "high"

    def _get_state_key(self, risk_score: float, responsiveness: str = "neutral") -> str:
        """Build state key from risk score and responsiveness."""
        risk_level = self._get_risk_level(risk_score)
        if responsiveness not in self.RESPONSIVENESS:
            responsiveness = "neutral"
        return f"{risk_level}_{responsiveness}"

    def select_action(self, risk_score: float, responsiveness: str = "neutral") -> Dict:
        """
        Select intervention using ε-greedy policy.
        Returns action name and details.
        """
        state_key = self._get_state_key(risk_score, responsiveness)

        # ε-greedy: explore with probability ε, exploit otherwise
        if random.random() < self.epsilon:
            action = random.choice(self.ACTIONS)
        else:
            # Choose action with highest Q-value
            q_values = self.q_table.get(state_key, {})
            if not q_values:
                action = random.choice(self.ACTIONS)
            else:
                action = max(q_values, key=q_values.get)

        # Safe Zone: Never intervene if risk is low
        if risk_score < 40:
            return {
                "action": "none",
                "name": "No Intervention",
                "description": "Risk level is low, no action needed",
                "icon": "✅",
                "intensity": 0,
                "state": state_key,
                "q_value": 0,
            }

        q_value = self.q_table.get(state_key, {}).get(action, 0)
        details = self.ACTION_DETAILS[action]

        return {
            "action": action,
            "name": details["name"],
            "description": details["description"],
            "icon": details["icon"],
            "intensity": details["intensity"],
            "state": state_key,
            "q_value": round(q_value, 4),
        }

    def update(
        self,
        risk_score: float,
        action: str,
        reward: float,
        next_risk_score: float,
        responsiveness: str = "neutral",
    ) -> Dict:
        """
        Update Q-table with new experience.
        
        Q(s,a) = Q(s,a) + α * (reward + γ * max(Q(s',a')) - Q(s,a))
        """
        if self.is_read_only:
            return {
                "status": "read_only_baseline",
                "message": "Baseline policy is read-only; updates must target per-session agent",
            }

        if action not in self.ACTIONS:
            return {"status": "invalid_action"}

        state_key = self._get_state_key(risk_score, responsiveness)
        next_state_key = self._get_state_key(next_risk_score, responsiveness)

        # Current Q-value
        current_q = self.q_table.get(state_key, {}).get(action, 0)

        # Best future Q-value
        next_q_values = self.q_table.get(next_state_key, {})
        max_next_q = max(next_q_values.values()) if next_q_values else 0

        # Q-learning update
        new_q = current_q + self.alpha * (reward + self.gamma * max_next_q - current_q)

        # Update Q-table
        if state_key not in self.q_table:
            self.q_table[state_key] = {}
        self.q_table[state_key][action] = new_q

        # Record history with capacity bound
        self.history.append({
            "state": state_key,
            "action": action,
            "reward": reward,
            "old_q": round(current_q, 4),
            "new_q": round(new_q, 4),
        })
        if len(self.history) > self.max_history:
            self.history.pop(0)

        # Decay epsilon slightly (reduce exploration over time)
        self.epsilon = max(0.05, self.epsilon * 0.995)

        return {
            "status": "updated",
            "state": state_key,
            "action": action,
            "reward": reward,
            "old_q": round(current_q, 4),
            "new_q": round(new_q, 4),
            "epsilon": round(self.epsilon, 4),
        }

    def get_q_table_summary(self) -> Dict:
        """Get summary of Q-table for dashboard display."""
        summary = {}
        for state, actions in self.q_table.items():
            best_action = max(actions, key=actions.get) if actions else "none"
            summary[state] = {
                "best_action": best_action,
                "best_q": round(actions.get(best_action, 0), 4),
                "all_q": {a: round(v, 4) for a, v in actions.items()},
            }
        return summary

    def save(self):
        """Save Q-table to disk. Disabled when agent is in read-only baseline mode."""
        if self.is_read_only:
            return
        os.makedirs(QTABLE_DIR, exist_ok=True)
        data = {
            "q_table": self.q_table,
            "epsilon": self.epsilon,
            "history_count": len(self.history),
        }
        with open(QTABLE_PATH, "w") as f:
            json.dump(data, f, indent=2)
        print(f"[RL] Q-table saved to {QTABLE_PATH}")

    def load(self) -> bool:
        """Load Q-table from disk. Returns True if loaded."""
        if os.path.exists(QTABLE_PATH):
            with open(QTABLE_PATH, "r") as f:
                data = json.load(f)
            self.q_table = data.get("q_table", self.q_table)
            self.epsilon = data.get("epsilon", self.epsilon)
            print(f"[RL] Q-table loaded from {QTABLE_PATH}")
            return True
        return False

    def get_stats(self) -> Dict:
        """Get agent statistics."""
        total_updates = len(self.history)
        recent = self.history[-10:] if self.history else []
        avg_reward = (
            sum(h["reward"] for h in recent) / len(recent) if recent else 0
        )
        return {
            "total_updates": total_updates,
            "epsilon": round(self.epsilon, 4),
            "avg_recent_reward": round(avg_reward, 2),
            "states_explored": len(self.q_table),
            "recent_history": recent[-5:],
        }


# Singleton baseline instance (read-only baseline policy)
rl_agent = RLInterventionAgent(is_read_only=True)
