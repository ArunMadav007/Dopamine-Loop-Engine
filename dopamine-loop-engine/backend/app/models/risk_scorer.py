"""
Addiction Risk Score Calculator for Dopamine Loop Disruption Engine.
Computes a 0-100 risk score from behavioral features.
"""

import numpy as np
from typing import Dict, Tuple

from app.data.feature_engine import (
    normalize_value,
    compute_time_factor,
    FEATURE_BOUNDS,
)


class RiskScorer:
    """Calculates addiction risk score using weighted behavioral features."""

    # Weights for each component
    WEIGHTS = {
        "scroll_speed": 0.25,
        "session_duration": 0.25,
        "click_rate": 0.20,
        "time_factor": 0.15,
        "pause_inverse": 0.15,
    }

    # Risk zones
    ZONES = {
        "SAFE": (0, 30),
        "WARNING": (30, 70),
        "HIGH_RISK": (70, 100),
    }

    ZONE_COLORS = {
        "SAFE": "#00ff88",
        "WARNING": "#ffaa00",
        "HIGH_RISK": "#ff0044",
    }

    def __init__(self):
        self.last_score = 0.0
        self.alpha_up = 0.25   # Climbs fast (25% step)
        self.alpha_down = 0.05 # Decays slowly (5% step), simulating cognitive cool-off

    def compute_score(self, features: Dict) -> Dict:
        """
        Compute addiction risk score from extracted features with EMA smoothing.
        
        Returns dict with score, zone, color, and component breakdown.
        """
        # Normalize raw features to 0-1
        scroll_norm = normalize_value(
            features.get("scroll_speed", 400), *FEATURE_BOUNDS["scroll_speed"]
        )
        session_norm = normalize_value(
            features.get("session_duration", 180), *FEATURE_BOUNDS["session_duration"]
        )
        click_norm = normalize_value(
            features.get("clicks_per_min", 12), *FEATURE_BOUNDS["clicks_per_min"]
        )
        time_factor = compute_time_factor(features.get("hour_of_day", 14))
        pause_inverse = 1.0 - features.get("pause_ratio", 0.5)

        # Weighted sum for instantaneous tick
        raw_score = (
            self.WEIGHTS["scroll_speed"] * scroll_norm
            + self.WEIGHTS["session_duration"] * session_norm
            + self.WEIGHTS["click_rate"] * click_norm
            + self.WEIGHTS["time_factor"] * time_factor
            + self.WEIGHTS["pause_inverse"] * pause_inverse
        )

        instant_score = float(np.clip(raw_score * 100, 0, 100))

        # Apply Exponential Moving Average (EMA) to simulate dopamine buildup/cooldown
        if instant_score > self.last_score:
            self.last_score = self.last_score + self.alpha_up * (instant_score - self.last_score)
        else:
            self.last_score = self.last_score + self.alpha_down * (instant_score - self.last_score)

        score = self.last_score

        # Determine zone
        zone = self._get_zone(score)
        color = self.ZONE_COLORS[zone]

        return {
            "score": round(score, 1),
            "zone": zone,
            "color": color,
            "components": {
                "scroll_speed": round(scroll_norm * 100, 1),
                "session_duration": round(session_norm * 100, 1),
                "click_rate": round(click_norm * 100, 1),
                "time_factor": round(time_factor * 100, 1),
                "pause_inverse": round(pause_inverse * 100, 1),
            },
            "weights": self.WEIGHTS,
        }

    def _get_zone(self, score: float) -> str:
        """Classify score into risk zone."""
        for zone_name, (low, high) in self.ZONES.items():
            if low <= score < high:
                return zone_name
        return "HIGH_RISK"


# Singleton instance
risk_scorer = RiskScorer()
