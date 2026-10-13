"""
Unit tests for Machine Learning behavior model, Risk Scorer, and RL Agent.
"""

import unittest
import pandas as pd

from app.models.behavior_model import behavior_model
from app.models.risk_scorer import risk_scorer
from app.models.rl_agent import rl_agent
from app.data.feature_engine import raw_to_model_input, extract_features


class ModelsUnitTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Ensure behavior model is loaded
        behavior_model.train()

    def test_behavior_model_predict_contract(self):
        """Model predict output must contain all expected probabilities and state."""
        df_input = raw_to_model_input({
            "scroll_speed": 400.0,
            "session_duration": 180.0,
            "clicks_per_min": 12.0,
            "app_switch_rate": 5.0,
            "hour_of_day": 14.0,
            "pause_ratio": 0.5,
        })
        pred = behavior_model.predict(df_input)
        self.assertIn("prediction", pred)
        self.assertIn("state", pred)
        self.assertIn(pred["state"], ("NORMAL", "ADDICTIVE"))
        self.assertIn("confidence", pred)
        self.assertIn("prob_normal", pred)
        self.assertIn("prob_addictive", pred)
        self.assertAlmostEqual(pred["prob_normal"] + pred["prob_addictive"], 1.0, places=4)

    def test_behavior_model_normal_vs_addictive(self):
        """Model must classify distinctly divergent behavioral vectors appropriately."""
        normal_input = raw_to_model_input({
            "scroll_speed": 300.0,
            "session_duration": 60.0,
            "clicks_per_min": 8.0,
            "app_switch_rate": 6.0,
            "hour_of_day": 14.0,
            "pause_ratio": 0.75,
        })
        pred_normal = behavior_model.predict(normal_input)
        self.assertEqual(pred_normal["state"], "NORMAL")

        addictive_input = raw_to_model_input({
            "scroll_speed": 1800.0,
            "session_duration": 1800.0,
            "clicks_per_min": 45.0,
            "app_switch_rate": 2.0,
            "hour_of_day": 2.0,
            "pause_ratio": 0.05,
        })
        pred_addictive = behavior_model.predict(addictive_input)
        self.assertEqual(pred_addictive["state"], "ADDICTIVE")

    def test_risk_scorer_zones(self):
        """Risk scorer must categorize safe vs warning vs high risk correctly."""
        safe_data = {
            "scroll_speed": 80.0,
            "session_duration": 15.0,
            "clicks_per_min": 4.0,
            "hour_of_day": 14.0,
            "pause_ratio": 0.85,
        }
        res_safe = risk_scorer.compute_score(safe_data, previous_score=0.0)
        self.assertEqual(res_safe["zone"], "SAFE")
        self.assertLess(res_safe["score"], 30.0)

        high_data = {
            "scroll_speed": 1450.0,
            "session_duration": 120.0,
            "clicks_per_min": 38.0,
            "hour_of_day": 23.0,
            "pause_ratio": 0.02,
        }
        res_high = risk_scorer.compute_score(high_data, previous_score=80.0)
        self.assertEqual(res_high["zone"], "HIGH_RISK")
        self.assertGreaterEqual(res_high["score"], 70.0)

    def test_rl_agent_action_selection(self):
        """RL agent returns 'none' for safe scores and valid action for high scores."""
        # Risk score under safe zone
        action_safe = rl_agent.select_action(20.0, "neutral")
        self.assertEqual(action_safe["action"], "none")

        # Risk score in elevated range
        action_high = rl_agent.select_action(85.0, "neutral")
        self.assertIn(action_high["action"], rl_agent.ACTIONS)

    def test_rl_baseline_policy_is_read_only(self):
        """Baseline RL agent is read-only and rejects direct mutation."""
        self.assertTrue(rl_agent.is_read_only)
        update = rl_agent.update(
            risk_score=80.0,
            action="forced_break",
            reward=1.0,
            next_risk_score=40.0,
            responsiveness="neutral",
        )
        self.assertEqual(update["status"], "read_only_baseline")

    def test_personalized_rl_agent_updates_without_mutating_baseline(self):
        """Personalized copies learn independently without modifying baseline or other copies."""
        pers_a = rl_agent.create_personalized_copy()
        pers_b = rl_agent.create_personalized_copy()

        state_key = pers_a._get_state_key(75.0, "resistant")
        baseline_val = rl_agent.q_table[state_key]["grayscale"]
        self.assertEqual(pers_a.q_table[state_key]["grayscale"], baseline_val)
        self.assertEqual(pers_b.q_table[state_key]["grayscale"], baseline_val)

        # Update Agent A
        update_res = pers_a.update(
            risk_score=75.0,
            action="grayscale",
            reward=1.0,
            next_risk_score=35.0,
            responsiveness="resistant",
        )
        self.assertEqual(update_res["status"], "updated")

        # Agent A's Q-value must change
        self.assertNotEqual(pers_a.q_table[state_key]["grayscale"], baseline_val)
        # Baseline and Agent B must remain completely unchanged
        self.assertEqual(pers_b.q_table[state_key]["grayscale"], baseline_val)
        self.assertEqual(rl_agent.q_table[state_key]["grayscale"], baseline_val)

    def test_loaded_model_accuracy_is_not_invented(self):
        """Verifies that loaded disk model leaves accuracy as None without inventing numbers."""
        self.assertIsNone(behavior_model.accuracy)

    def test_reproducible_synthetic_benchmark_evaluation(self):
        """
        Model evaluator generates a reproducible benchmark on synthetic distributions
        reporting accuracy, precision, recall, f1, and roc_auc without claiming real-world validation.
        """
        benchmark = behavior_model.get_benchmark_summary()
        self.assertIsNotNone(benchmark)
        self.assertTrue(benchmark["is_synthetic"])
        self.assertIn("synthetic", benchmark["dataset_name"])
        self.assertIn("metrics", benchmark)

        metrics = benchmark["metrics"]
        self.assertIn("accuracy", metrics)
        self.assertIn("precision", metrics)
        self.assertIn("recall", metrics)
        self.assertIn("f1", metrics)
        self.assertIn("roc_auc", metrics)

        # Metrics are bounded between 0.0 and 1.0
        for k in ("accuracy", "precision", "recall", "f1", "roc_auc"):
            self.assertGreaterEqual(metrics[k], 0.5)
            self.assertLessEqual(metrics[k], 1.0)

        # Clear synthetic disclaimer is included
        self.assertIn("disclaimer", benchmark)

    def test_deterministic_evaluation(self):
        """Repeated evaluations of the loaded model yield identical deterministic metrics."""
        res1 = behavior_model.run_synthetic_benchmark()
        res2 = behavior_model.run_synthetic_benchmark()

        self.assertEqual(res1["metrics"], res2["metrics"])
        self.assertEqual(res1["holdout_summary"], res2["holdout_summary"])
        self.assertEqual(
            res1["compatibility_investigation"]["artifact_sha256"],
            res2["compatibility_investigation"]["artifact_sha256"],
        )

    def test_independent_generation_from_training_dataset(self):
        """Evaluator generates independent holdout samples with distinct seeds from training."""
        from app.data.synthetic_generator import generate_dataset
        from app.models.model_evaluator import (
            generate_synthetic_holdout_dataset,
            HOLDOUT_SEED_NORMAL,
            HOLDOUT_SEED_ADDICTIVE,
        )

        # Training dataset generated with default parameters (seeds 42, 123)
        X_train, y_train = generate_dataset()

        # Holdout benchmark dataset generated by evaluator helper
        X_holdout, y_holdout = generate_synthetic_holdout_dataset()

        # Seeds must be distinct from training seeds
        self.assertNotEqual(HOLDOUT_SEED_NORMAL, 42)
        self.assertNotEqual(HOLDOUT_SEED_ADDICTIVE, 123)

        # Ensure holdout sample values differ from training set
        train_first_row = X_train.iloc[0].to_dict()
        holdout_first_row = X_holdout.iloc[0].to_dict()
        self.assertNotEqual(train_first_row, holdout_first_row)

        # Custom seed parameter test: distinct seeds produce distinct datasets
        X_custom, _ = generate_dataset(seed=9999)
        self.assertFalse(X_custom.head().equals(X_train.head()))
        self.assertFalse(X_custom.head().equals(X_holdout.head()))

    def test_accurate_metric_reporting(self):
        """Metrics accurately reflect model predictions on the holdout benchmark dataset."""
        from sklearn.metrics import (
            accuracy_score,
            precision_score,
            recall_score,
            f1_score,
            roc_auc_score,
            confusion_matrix,
        )
        from app.models.model_evaluator import generate_synthetic_holdout_dataset

        benchmark = behavior_model.get_benchmark_summary()
        self.assertIsNotNone(benchmark)

        # Clearly labeled as synthetic holdout benchmark
        self.assertTrue(benchmark["is_synthetic"])
        self.assertEqual(benchmark["benchmark_type"], "synthetic_holdout_benchmark")
        self.assertIn("holdout", benchmark["dataset_name"])
        self.assertIn("disclaimer", benchmark)

        # Recompute ground truth metrics on the exact same holdout distribution
        X_holdout, y_holdout = generate_synthetic_holdout_dataset()
        features_ordered = X_holdout[behavior_model.feature_columns]
        y_pred = behavior_model.model.predict(features_ordered)
        y_proba = behavior_model.model.predict_proba(features_ordered)

        expected_acc = round(float(accuracy_score(y_holdout, y_pred)), 4)
        expected_prec = round(float(precision_score(y_holdout, y_pred)), 4)
        expected_rec = round(float(recall_score(y_holdout, y_pred)), 4)
        expected_f1 = round(float(f1_score(y_holdout, y_pred)), 4)
        expected_roc_auc = round(float(roc_auc_score(y_holdout, y_proba[:, 1])), 4)
        expected_conf_mat = confusion_matrix(y_holdout, y_pred).tolist()

        metrics = benchmark["metrics"]
        self.assertEqual(metrics["accuracy"], expected_acc)
        self.assertEqual(metrics["precision"], expected_prec)
        self.assertEqual(metrics["recall"], expected_rec)
        self.assertEqual(metrics["f1"], expected_f1)
        self.assertEqual(metrics["roc_auc"], expected_roc_auc)
        self.assertEqual(metrics["confusion_matrix"], expected_conf_mat)

    def test_artifact_immutability(self):
        """Model artifact on disk is not overwritten, retrained, or modified during evaluation."""
        from app.models.behavior_model import MODEL_PATH
        from app.models.model_evaluator import get_artifact_sha256

        hash_before = get_artifact_sha256(MODEL_PATH)
        self.assertIsNotNone(hash_before)

        # Run benchmark evaluation
        benchmark = behavior_model.run_synthetic_benchmark()

        hash_after = get_artifact_sha256(MODEL_PATH)
        self.assertEqual(hash_before, hash_after)
        self.assertEqual(
            benchmark["compatibility_investigation"]["artifact_sha256"], hash_before
        )

    def test_compatibility_status_truthful(self):
        """Compatibility investigation provides truthful status without unsupported numerical claims."""
        benchmark = behavior_model.get_benchmark_summary()
        compat = benchmark["compatibility_investigation"]

        self.assertIn("compatibility_status", compat)
        self.assertIn("warning_note", compat)

        # Must NOT claim that inference executes without degradation without direct verification
        note = compat["warning_note"].lower()
        self.assertNotIn("without numerical degradation", note)
        self.assertIn("cross-version", note)
        self.assertIn("unverified", compat["compatibility_status"])


if __name__ == "__main__":
    unittest.main()
