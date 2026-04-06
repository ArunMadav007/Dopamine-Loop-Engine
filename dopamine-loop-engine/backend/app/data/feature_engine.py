"""
Feature Engineering Engine for Dopamine Loop Disruption Engine.
Transforms raw behavioral data into meaningful ML features.
"""

import numpy as np
import pandas as pd
from typing import Dict


# Normalization bounds for each raw feature (compressed for rapid hackathon demo)
FEATURE_BOUNDS = {
    "scroll_speed": (50, 1500),      # Reaches max risk scroll speed much faster
    "session_duration": (10, 120),   # 2 minutes of doomscrolling is treated as critical
    "clicks_per_min": (2, 40),
    "app_switch_rate": (0, 35),
    "hour_of_day": (0, 24),
    "pause_ratio": (0, 1),
}


def normalize_value(value: float, min_val: float, max_val: float) -> float:
    """Normalize a value to 0-1 range."""
    return np.clip((value - min_val) / (max_val - min_val + 1e-8), 0.0, 1.0)


def compute_time_factor(hour: float) -> float:
    """
    Compute risk factor based on time of day.
    Late night (22:00-04:00) = high risk, daytime = low risk.
    """
    if 22 <= hour <= 24 or 0 <= hour < 4:
        return 0.9 + 0.1 * np.random.random()  # High risk
    elif 4 <= hour < 7:
        return 0.6
    elif 20 <= hour < 22:
        return 0.5
    else:
        return 0.1 + 0.2 * (abs(hour - 14) / 10)  # Low risk during day


def compute_dopamine_spike_indicator(
    scroll_speed: float, clicks_per_min: float, pause_ratio: float
) -> float:
    """
    Dopamine spike indicator: high scroll + high clicks + low pauses.
    Returns value between 0 and 1.
    """
    scroll_norm = normalize_value(scroll_speed, *FEATURE_BOUNDS["scroll_speed"])
    click_norm = normalize_value(clicks_per_min, *FEATURE_BOUNDS["clicks_per_min"])
    pause_inv = 1.0 - pause_ratio  # Invert: low pause = high indicator

    spike = (0.4 * scroll_norm + 0.35 * click_norm + 0.25 * pause_inv)
    return float(np.clip(spike, 0, 1))


def compute_session_intensity(
    session_duration: float, clicks_per_min: float, scroll_speed: float
) -> float:
    """
    Session intensity: how intensely the user is engaged.
    Combines duration with activity rate.
    """
    dur_norm = normalize_value(session_duration, *FEATURE_BOUNDS["session_duration"])
    click_norm = normalize_value(clicks_per_min, *FEATURE_BOUNDS["clicks_per_min"])
    scroll_norm = normalize_value(scroll_speed, *FEATURE_BOUNDS["scroll_speed"])

    intensity = (0.4 * dur_norm + 0.3 * click_norm + 0.3 * scroll_norm)
    return float(np.clip(intensity, 0, 1))


def extract_features(raw_data: Dict) -> Dict:
    """
    Extract derived features from raw behavioral data.
    Input: raw sensor/tracking data
    Output: enriched feature dict for model input
    """
    scroll_speed = raw_data.get("scroll_speed", 400)
    session_duration = raw_data.get("session_duration", 180)
    clicks_per_min = raw_data.get("clicks_per_min", 12)
    app_switch_rate = raw_data.get("app_switch_rate", 5)
    hour_of_day = raw_data.get("hour_of_day", 14)
    pause_ratio = raw_data.get("pause_ratio", 0.5)

    features = {
        # Raw features (normalized)
        "scroll_speed": scroll_speed,
        "session_duration": session_duration,
        "clicks_per_min": clicks_per_min,
        "app_switch_rate": app_switch_rate,
        "hour_of_day": hour_of_day,
        "pause_ratio": pause_ratio,
    }

    # Derived features for analysis
    derived = {
        "time_factor": compute_time_factor(hour_of_day),
        "dopamine_spike": compute_dopamine_spike_indicator(
            scroll_speed, clicks_per_min, pause_ratio
        ),
        "session_intensity": compute_session_intensity(
            session_duration, clicks_per_min, scroll_speed
        ),
        # Normalized values for risk score
        "scroll_speed_norm": normalize_value(scroll_speed, *FEATURE_BOUNDS["scroll_speed"]),
        "session_duration_norm": normalize_value(session_duration, *FEATURE_BOUNDS["session_duration"]),
        "click_rate_norm": normalize_value(clicks_per_min, *FEATURE_BOUNDS["clicks_per_min"]),
    }

    return {**features, **derived}


def raw_to_model_input(raw_data: Dict) -> pd.DataFrame:
    """Convert raw data dict to DataFrame suitable for model prediction."""
    return pd.DataFrame(
        [
            {
                "scroll_speed": raw_data.get("scroll_speed", 400),
                "session_duration": raw_data.get("session_duration", 180),
                "clicks_per_min": raw_data.get("clicks_per_min", 12),
                "app_switch_rate": raw_data.get("app_switch_rate", 5),
                "hour_of_day": raw_data.get("hour_of_day", 14),
                "pause_ratio": raw_data.get("pause_ratio", 0.5),
            }
        ]
    )
