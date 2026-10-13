"""
Reproducible Synthetic Benchmark and Scikit-Learn Compatibility Evaluator.
Evaluates the loaded behavior detection model on an isolated synthetic holdout benchmark
without modifying, overwriting, or retraining the disk artifact.
"""

import os
import hashlib
import sklearn
import numpy as np
import pandas as pd
from typing import Dict, Any, Optional
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    roc_auc_score,
    confusion_matrix,
)

from app.data.synthetic_generator import generate_dataset


# Documented distinct seeds for the synthetic holdout benchmark.
# Training uses seed_normal=42, seed_addictive=123, shuffle_seed=42.
# The holdout benchmark uses independent seeds to avoid sample overlap.
HOLDOUT_SEED_NORMAL = 842
HOLDOUT_SEED_ADDICTIVE = 8123
HOLDOUT_SHUFFLE_SEED = 842
HOLDOUT_N_NORMAL = 250
HOLDOUT_N_ADDICTIVE = 250


def get_artifact_sha256(file_path: str) -> Optional[str]:
    """Compute SHA-256 hash of the model artifact to ensure immutability."""
    if not os.path.exists(file_path):
        return None
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def generate_synthetic_holdout_dataset(
    n_normal: int = HOLDOUT_N_NORMAL,
    n_addictive: int = HOLDOUT_N_ADDICTIVE,
    seed_normal: int = HOLDOUT_SEED_NORMAL,
    seed_addictive: int = HOLDOUT_SEED_ADDICTIVE,
    shuffle_seed: int = HOLDOUT_SHUFFLE_SEED,
) -> tuple[pd.DataFrame, pd.Series]:
    """
    Generate an independent synthetic holdout dataset with seeds distinct from training.
    """
    return generate_dataset(
        n_normal=n_normal,
        n_addictive=n_addictive,
        seed_normal=seed_normal,
        seed_addictive=seed_addictive,
        shuffle_seed=shuffle_seed,
    )


def evaluate_loaded_model(
    model_wrapper: Any,
    holdout_features: Optional[pd.DataFrame] = None,
    holdout_labels: Optional[pd.Series] = None,
) -> Dict[str, Any]:
    """
    Conduct an isolated, reproducible evaluation of the loaded RandomForest model.

    STRICT CONSTRAINTS:
    - Does NOT train, fit, or mutate the model.
    - Evaluates solely on an independent synthetic holdout benchmark dataset.
    - Clearly labels all results as a synthetic holdout benchmark rather than real-world validation.
    - Does not claim cross-version numerical equivalence without a direct comparison.
    """
    if not model_wrapper.is_trained or model_wrapper.model is None:
        raise RuntimeError("Model is not loaded. Cannot evaluate uninitialized model.")

    from app.models.behavior_model import MODEL_PATH

    hash_before = get_artifact_sha256(MODEL_PATH)

    # 1. Generate or use supplied independent synthetic holdout dataset
    if holdout_features is None or holdout_labels is None:
        X_test, y_test = generate_synthetic_holdout_dataset()
        holdout_params = {
            "n_normal": HOLDOUT_N_NORMAL,
            "n_addictive": HOLDOUT_N_ADDICTIVE,
            "seed_normal": HOLDOUT_SEED_NORMAL,
            "seed_addictive": HOLDOUT_SEED_ADDICTIVE,
            "shuffle_seed": HOLDOUT_SHUFFLE_SEED,
        }
    else:
        X_test, y_test = holdout_features, holdout_labels
        holdout_params = {
            "n_normal": int((y_test == 0).sum()),
            "n_addictive": int((y_test == 1).sum()),
            "seed_normal": "custom",
            "seed_addictive": "custom",
            "shuffle_seed": "custom",
        }

    # 2. Ensure feature order matches model
    features_ordered = X_test[model_wrapper.feature_columns]

    # 3. Run inference using the loaded model
    y_pred = model_wrapper.model.predict(features_ordered)
    y_proba = model_wrapper.model.predict_proba(features_ordered)

    # 4. Calculate metrics
    acc = float(accuracy_score(y_test, y_pred))
    prec = float(precision_score(y_test, y_pred))
    rec = float(recall_score(y_test, y_pred))
    f1 = float(f1_score(y_test, y_pred))
    roc_auc = float(roc_auc_score(y_test, y_proba[:, 1]))
    conf_mat = confusion_matrix(y_test, y_pred).tolist()

    # 5. Verify artifact hash before and after to ensure immutability
    hash_after = get_artifact_sha256(MODEL_PATH)
    if hash_before is not None and hash_after is not None and hash_before != hash_after:
        raise RuntimeError(
            "CRITICAL: Model artifact hash changed during evaluation! Artifact must be immutable."
        )

    return {
        "is_synthetic": True,
        "benchmark_type": "synthetic_holdout_benchmark",
        "dataset_name": "synthetic_holdout_benchmark_v1",
        "evaluation_timestamp": pd.Timestamp.now().isoformat(),
        "disclaimer": (
            "These metrics reflect performance exclusively on an independent synthetic holdout benchmark. "
            "They do NOT constitute clinical or real-world human behavioral validation."
        ),
        "holdout_summary": {
            "total_synthetic_samples": len(X_test),
            "holdout_samples": len(y_test),
            "normal_samples": int((y_test == 0).sum()),
            "addictive_samples": int((y_test == 1).sum()),
            "parameters": holdout_params,
        },
        "split_summary": {
            "total_synthetic_samples": len(X_test),
            "test_samples": len(y_test),
            "normal_test_samples": int((y_test == 0).sum()),
            "addictive_test_samples": int((y_test == 1).sum()),
            "parameters": holdout_params,
        },
        "metrics": {
            "accuracy": round(acc, 4),
            "precision": round(prec, 4),
            "recall": round(rec, 4),
            "f1": round(f1, 4),
            "roc_auc": round(roc_auc, 4),
            "confusion_matrix": conf_mat,
        },
        "compatibility_investigation": {
            "runtime_scikit_learn_version": sklearn.__version__,
            "artifact_saved_version": "1.8.0",
            "artifact_sha256": hash_after,
            "inference_status": "functional_unverified_cross_version_equivalence",
            "compatibility_status": "functional_unverified_cross_version_equivalence",
            "warning_note": (
                f"InconsistentVersionWarning may occur when unpickling an artifact serialized under scikit-learn 1.8.0 "
                f"with runtime {sklearn.__version__}. While inference executes without exceptions and produces valid probability distributions, "
                "cross-version numerical equivalence has not been directly verified against the serialization environment."
            ),
        },
    }
