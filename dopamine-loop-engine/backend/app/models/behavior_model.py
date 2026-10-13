"""
Behavior Detection Model for Dopamine Loop Disruption Engine.
RandomForest classifier to detect NORMAL vs ADDICTIVE states.
"""

import os
from typing import Optional, Dict
import numpy as np
import pandas as pd
import joblib
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, classification_report

from app.data.synthetic_generator import generate_dataset

MODEL_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "saved_models")
MODEL_PATH = os.path.join(MODEL_DIR, "behavior_model.joblib")


class BehaviorDetectionModel:
    """RandomForest classifier for detecting addictive behavior states."""

    def __init__(self):
        self.model = None
        self.feature_columns = [
            "scroll_speed",
            "session_duration",
            "clicks_per_min",
            "app_switch_rate",
            "hour_of_day",
            "pause_ratio",
        ]
        self.accuracy: Optional[float] = None
        self.is_trained = False
        self._benchmark_summary: Optional[Dict] = None

    def train(self, force_retrain: bool = False) -> dict:
        """Train the model on synthetic data, or load existing model."""
        os.makedirs(MODEL_DIR, exist_ok=True)

        if os.path.exists(MODEL_PATH) and not force_retrain:
            print("[MODEL] Loading existing model...")
            self.model = joblib.load(MODEL_PATH)
            self.is_trained = True
            # Evaluation metadata was not persisted with this joblib artifact.
            # Accuracy is marked None (unavailable) rather than inventing unverified numbers.
            self.accuracy = None
            self.run_synthetic_benchmark()
            return {"status": "loaded", "model_path": MODEL_PATH, "accuracy": None}

        print("[MODEL] Training new model on synthetic data...")
        X, y = generate_dataset(n_normal=750, n_addictive=750)

        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )

        self.model = RandomForestClassifier(
            n_estimators=100,
            max_depth=12,
            min_samples_split=5,
            min_samples_leaf=2,
            random_state=42,
            n_jobs=-1,
        )

        self.model.fit(X_train, y_train)

        # Evaluate
        y_pred = self.model.predict(X_test)
        self.accuracy = accuracy_score(y_test, y_pred)
        report = classification_report(y_test, y_pred, output_dict=True)

        # Save model
        joblib.dump(self.model, MODEL_PATH)
        self.is_trained = True

        print(f"[MODEL] Accuracy: {self.accuracy:.4f}")
        print(f"[MODEL] Model saved to {MODEL_PATH}")

        return {
            "status": "trained",
            "accuracy": round(self.accuracy, 4),
            "report": report,
            "model_path": MODEL_PATH,
        }

    def predict(self, features: pd.DataFrame) -> dict:
        """Predict behavior state from features."""
        if not self.is_trained or self.model is None:
            raise RuntimeError("Model not trained. Call train() first.")

        # Ensure correct column order
        features = features[self.feature_columns]

        prediction = self.model.predict(features)[0]
        probabilities = self.model.predict_proba(features)[0]

        return {
            "prediction": int(prediction),
            "state": "ADDICTIVE" if prediction == 1 else "NORMAL",
            "confidence": float(max(probabilities)),
            "prob_normal": float(probabilities[0]),
            "prob_addictive": float(probabilities[1]),
        }

    def get_feature_importance(self) -> dict:
        """Get feature importance from trained model."""
        if not self.is_trained or self.model is None:
            return {}

        importances = self.model.feature_importances_
        return {
            col: round(float(imp), 4)
            for col, imp in zip(self.feature_columns, importances)
        }

    def run_synthetic_benchmark(self) -> dict:
        """
        Run reproducible synthetic benchmark evaluation on the loaded model without retraining.
        Preserves the disk artifact immutably.
        """
        from app.models.model_evaluator import evaluate_loaded_model
        results = evaluate_loaded_model(self)
        self._benchmark_summary = results
        return results

    def get_benchmark_summary(self) -> Optional[dict]:
        """Return the synthetic benchmark summary if evaluated."""
        return self._benchmark_summary


# Singleton instance
behavior_model = BehaviorDetectionModel()
