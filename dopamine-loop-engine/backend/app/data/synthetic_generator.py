"""
Synthetic Data Generator for Dopamine Loop Disruption Engine.
Generates realistic behavioral data for training the addiction detection model.
"""

import numpy as np
import pandas as pd
from typing import Tuple


def generate_normal_behavior(n_samples: int = 750) -> pd.DataFrame:
    """Generate data representing normal, healthy usage patterns."""
    np.random.seed(42)

    data = {
        # Scroll speed: moderate, 200-800 px/sec
        "scroll_speed": np.random.normal(400, 150, n_samples).clip(50, 900),
        # Session duration: short, 60-600 seconds (1-10 min)
        "session_duration": np.random.exponential(180, n_samples).clip(30, 600),
        # Clicks per minute: low-moderate, 5-20
        "clicks_per_min": np.random.normal(12, 5, n_samples).clip(2, 25),
        # App switch rate: moderate, users switch apps 3-15 times
        "app_switch_rate": np.random.normal(8, 3, n_samples).clip(1, 15),
        # Time of day: distributed throughout day, peak afternoon (0-24 hours)
        "hour_of_day": np.random.normal(14, 4, n_samples).clip(0, 23.99),
        # Pause ratio: higher for normal users (they stop and think)
        "pause_ratio": np.random.beta(5, 2, n_samples).clip(0.2, 0.95),
        # Label: 0 = normal
        "label": np.zeros(n_samples, dtype=int),
    }

    return pd.DataFrame(data)


def generate_addictive_behavior(n_samples: int = 750) -> pd.DataFrame:
    """Generate data representing addictive, compulsive usage patterns."""
    np.random.seed(123)

    data = {
        # Scroll speed: very high, rapid scrolling 800-2500 px/sec
        "scroll_speed": np.random.normal(1400, 400, n_samples).clip(700, 3000),
        # Session duration: very long, 600-3600+ seconds (10-60+ min)
        "session_duration": np.random.exponential(900, n_samples).clip(300, 5400),
        # Clicks per minute: high, rapid tapping 25-60
        "clicks_per_min": np.random.normal(40, 12, n_samples).clip(20, 80),
        # App switch rate: low (stuck in one app) or very high (frantic)
        "app_switch_rate": np.random.choice(
            [
                *np.random.normal(2, 1, n_samples // 2).clip(0, 5),
                *np.random.normal(18, 5, n_samples // 2).clip(12, 35),
            ],
            n_samples,
        ),
        # Time of day: late night bias (22-4 AM)
        "hour_of_day": (np.random.normal(1, 3, n_samples) % 24).clip(0, 23.99),
        # Pause ratio: very low (continuous scrolling, no stops)
        "pause_ratio": np.random.beta(1.5, 6, n_samples).clip(0.01, 0.4),
        # Label: 1 = addictive
        "label": np.ones(n_samples, dtype=int),
    }

    return pd.DataFrame(data)


def generate_dataset(n_normal: int = 750, n_addictive: int = 750) -> Tuple[pd.DataFrame, pd.Series]:
    """Generate complete synthetic dataset with both behavior types."""
    normal = generate_normal_behavior(n_normal)
    addictive = generate_addictive_behavior(n_addictive)

    dataset = pd.concat([normal, addictive], ignore_index=True)
    dataset = dataset.sample(frac=1, random_state=42).reset_index(drop=True)

    features = dataset.drop("label", axis=1)
    labels = dataset["label"]

    return features, labels


def generate_single_sample(
    scroll_speed: float = 500.0,
    session_duration: float = 300.0,
    clicks_per_min: float = 15.0,
    app_switch_rate: float = 5.0,
    hour_of_day: float = 14.0,
    pause_ratio: float = 0.5,
) -> pd.DataFrame:
    """Generate a single feature vector from raw behavioral data."""
    return pd.DataFrame(
        [
            {
                "scroll_speed": scroll_speed,
                "session_duration": session_duration,
                "clicks_per_min": clicks_per_min,
                "app_switch_rate": app_switch_rate,
                "hour_of_day": hour_of_day,
                "pause_ratio": pause_ratio,
            }
        ]
    )


if __name__ == "__main__":
    features, labels = generate_dataset()
    print(f"Dataset shape: {features.shape}")
    print(f"Label distribution:\n{labels.value_counts()}")
    print(f"\nFeature statistics:\n{features.describe()}")
