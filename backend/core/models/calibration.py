import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import mlflow
from sklearn.calibration import CalibratedClassifierCV, calibration_curve
from sklearn.frozen import FrozenEstimator

from core.logging import get_logger
from core.models.common import classifier_metrics

logger = get_logger(__name__)

CALIBRATION_METHOD = "sigmoid"


def calibrate_if_better(model, x_val, y_val, n_classes: int, metrics_val: dict) -> tuple:
    """Calibrates `model` on validation data; serves it only if Brier improves.

    Returns (final_model, final_metrics_val). Logs a reliability diagram to the
    active MLflow run either way, plotted from whichever model is finally served.
    """
    calibration_info = {"applied": False, "method": CALIBRATION_METHOD}
    final_model, final_metrics_val = model, metrics_val

    try:
        calibrated = CalibratedClassifierCV(FrozenEstimator(model), method=CALIBRATION_METHOD).fit(
            x_val, y_val
        )
        calibrated_metrics = classifier_metrics(calibrated, x_val, y_val, n_classes)
        calibration_info["brier_uncalibrated"] = metrics_val["brier"]
        calibration_info["brier_calibrated"] = calibrated_metrics["brier"]

        if calibrated_metrics["brier"] < metrics_val["brier"]:
            calibration_info["applied"] = True
            final_model, final_metrics_val = calibrated, calibrated_metrics
            logger.info("Serving calibrated model", extra=calibration_info)
        else:
            logger.info(
                "Calibration did not improve Brier score, serving raw model", extra=calibration_info
            )
    except Exception as exc:
        calibration_info["error"] = str(exc)
        logger.warning("Calibration failed, serving uncalibrated model", extra=calibration_info)

    final_metrics_val = {**final_metrics_val, "calibration": calibration_info}
    _log_calibration_plot(final_model, x_val, y_val, n_classes)
    return final_model, final_metrics_val


def _log_calibration_plot(model, x_val, y_val, n_classes: int) -> None:
    try:
        probs = model.predict_proba(x_val)
        fig, ax = plt.subplots()
        ax.plot([0, 1], [0, 1], linestyle="--", color="gray", label="Perfectly calibrated")
        for i, class_id in enumerate(model.classes_):
            y_true_binary = (y_val == class_id).astype(int)
            prob_true, prob_pred = calibration_curve(
                y_true_binary, probs[:, i], n_bins=5, strategy="quantile"
            )
            ax.plot(prob_pred, prob_true, marker="o", label=f"class {int(class_id)}")
        ax.set_xlabel("Mean predicted probability")
        ax.set_ylabel("Fraction of positives")
        ax.set_title("Calibration curve")
        ax.legend(fontsize="small")
        mlflow.log_figure(fig, "calibration_curve.png")
        plt.close(fig)
    except Exception as exc:
        logger.warning("Failed to log calibration plot", extra={"error": str(exc)})
