import numpy as np
import pandas as pd
from sklearn.mixture import GaussianMixture
from sklearn.preprocessing import StandardScaler

from core.models.regime import REGIME_CLASSES

GMM_FEATURES = ["ret_20d", "rvol_20d", "brent_wti_spread"]
AGREEMENT_REVIEW_THRESHOLD = 0.70


def validate_regime_labels(
    train_x: pd.DataFrame,
    train_y: pd.Series,
    val_x: pd.DataFrame,
    val_y: pd.Series,
) -> dict:
    """Compares REGIME_TRANSITIONS labels against an independently-fitted GMM.

    Fits StandardScaler + GaussianMixture on the training window only, maps
    components to regimes by majority vote against train_y, then applies that
    fixed mapping to validation data without fitting a second GMM.
    """
    missing = [f for f in GMM_FEATURES if f not in train_x.columns]
    if missing:
        return {
            "agreement_train": None,
            "agreement_val": None,
            "review_trigger": False,
            "error": f"missing features: {missing}",
        }

    scaler = StandardScaler()
    train_scaled = scaler.fit_transform(train_x[GMM_FEATURES])
    gmm = GaussianMixture(n_components=len(REGIME_CLASSES), random_state=42)
    train_components = gmm.fit_predict(train_scaled)

    component_to_regime = _map_components_to_regimes(train_components, train_y)
    train_gmm_labels = pd.Series(
        [component_to_regime[c] for c in train_components], index=train_x.index
    )
    agreement_train = float((train_gmm_labels == train_y).mean())

    common_val = val_x.index.intersection(val_y.index)
    if len(common_val) == 0:
        agreement_val = None
    else:
        val_scaled = scaler.transform(val_x.loc[common_val, GMM_FEATURES])
        val_components = gmm.predict(val_scaled)
        default_regime = component_to_regime[next(iter(component_to_regime))]
        val_gmm_labels = pd.Series(
            [component_to_regime.get(c, default_regime) for c in val_components],
            index=common_val,
        )
        agreement_val = float((val_gmm_labels == val_y.loc[common_val]).mean())

    return {
        "agreement_train": round(agreement_train, 4),
        "agreement_val": round(agreement_val, 4) if agreement_val is not None else None,
        "review_trigger": agreement_val is not None and agreement_val <= AGREEMENT_REVIEW_THRESHOLD,
    }


def _map_components_to_regimes(components: np.ndarray, train_y: pd.Series) -> dict[int, str]:
    components_series = pd.Series(components, index=train_y.index)
    mapping = {}
    for component in np.unique(components):
        matched_labels = train_y[components_series == component]
        if matched_labels.empty:
            mapping[component] = REGIME_CLASSES[0]
        else:
            mapping[component] = matched_labels.value_counts().idxmax()
    return mapping
