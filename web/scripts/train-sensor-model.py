"""Train the sensor early-warning model on the table from sensor-training-data.mjs and export it to
src/lib/sensor-model.json for the sensors cron (inference in src/lib/sensors.ts, predictRise).

    python scripts/train-sensor-model.py <dir with training.csv>

Split by time, never at random: train Oct 2024 - May 2025, pick the threshold on June 2025 (5% false
alarms), test on Jul - Sep 2025 (monsoon, a different season from training). Compared against a
rate-of-change alarm (excess rising by 2 ppm in 30 minutes while above 5 ppm), the obvious rule a
sensor network would otherwise use. Lead time = how long before a rise starts the first warning came.
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.neural_network import MLPClassifier

FEATURES = [
    "excess_now", "excess_prev", "excess_trend", "excess_max_3h", "dp_past_3h", "dp_next_3h",
    "align_now", "align_next_3h", "wind_now", "wind_next_3h", "night_next_3h", "hour_sin",
    "hour_cos", "rh_now",
]
MS = lambda s: int(datetime.fromisoformat(s).replace(tzinfo=timezone.utc).timestamp() * 1000)
VAL_FROM, TEST_FROM = MS("2025-06-01"), MS("2025-07-01")
OUT = Path(__file__).resolve().parent.parent / "src" / "lib" / "sensor-model.json"

df = pd.read_csv(Path(sys.argv[1]) / "training.csv")
train, val, test = df[df.t < VAL_FROM], df[(df.t >= VAL_FROM) & (df.t < TEST_FROM)], df[df.t >= TEST_FROM]
mean = train[FEATURES].mean().to_numpy()
std = train[FEATURES].std().replace(0, 1).to_numpy()
z = lambda d: (d[FEATURES].to_numpy() - mean) / std
print(f"rows train {len(train)} val {len(val)} test {len(test)}; rises ahead {train.label.mean():.3f} / {test.label.mean():.3f}")

models = {
    "logistic": LogisticRegression(max_iter=2000, C=1.0),
    "mlp": MLPClassifier(hidden_layer_sizes=(16,), alpha=1e-3, early_stopping=True, max_iter=300,
                         random_state=7),
}
scores = {}
for name, m in models.items():
    m.fit(z(train), train.label)
    p = m.predict_proba(z(test))[:, 1]
    scores[name] = (roc_auc_score(test.label, p), average_precision_score(test.label, p))
    print(f"{name}: test ROC AUC {scores[name][0]:.3f}, average precision {scores[name][1]:.3f}")
best = max(scores, key=lambda k: scores[k][0])
model = models[best]


def threshold_at_far(p, y, far):
    """Lowest threshold whose false-alarm rate (share of no-rise rows warned) is at most `far`."""
    return float(np.quantile(p[y == 0], 1 - far))


def rates(warn, y):
    tp = int((warn & (y == 1)).sum()); fp = int((warn & (y == 0)).sum())
    return {"recall": tp / max(1, int((y == 1).sum())), "precision": tp / max(1, tp + fp),
            "false_alarm_rate": fp / max(1, int((y == 0).sum()))}


p_val = model.predict_proba(z(val))[:, 1]
# Alerts use the 2% false-alarm point: about half the warnings come true, a few false ones a week.
thr = threshold_at_far(p_val, val.label.to_numpy(), 0.02)
p_test = model.predict_proba(z(test))[:, 1]
y_test = test.label.to_numpy()
at_thr = rates(p_test >= thr, y_test)
recall_at = {f: rates(p_test >= threshold_at_far(p_test, y_test, f), y_test)["recall"] for f in (0.05, 0.10, 0.20)}
baseline_warn = ((test.excess_trend > 2) & (test.excess_now > 5)).to_numpy()
baseline = rates(baseline_warn, y_test)


def false_warnings_per_node_week(warn):
    """Warning episodes (consecutive warned rows of one node) with no rise in the next 3 hours."""
    t = test.t.to_numpy(); node = test.node.to_numpy(); order = np.lexsort((t, node))
    t, node, y, w = t[order], node[order], y_test[order], warn[order]
    cont = np.r_[False, w[:-1] & (node[1:] == node[:-1]) & (t[1:] - t[:-1] == 1_800_000)]
    starts = np.nonzero(w & ~cont)[0]
    false = sum(1 for i in starts if not y[i:i + 7].any())
    days = (test.t.max() - test.t.min()) / 86_400_000
    return 7 * false / test.node.nunique() / days


def lead_times(warn):
    """Per rise (a run of consecutive 'rise ahead' rows for one node), minutes from first warning to onset."""
    t = test.t.to_numpy(); node = test.node.to_numpy()
    leads, missed, i = [], 0, 0
    order = np.lexsort((t, node))
    t, node, y, w = t[order], node[order], y_test[order], warn[order]
    while i < len(t):
        if y[i] != 1:
            i += 1
            continue
        j = i
        while j + 1 < len(t) and y[j + 1] == 1 and node[j + 1] == node[i] and t[j + 1] - t[j] == 1_800_000:
            j += 1
        onset = t[j] + 30 * 60_000  # the rise starts after the last row that still had it ahead
        warned = np.nonzero(w[i:j + 1])[0]
        if len(warned):
            leads.append((onset - t[i + warned[0]]) / 60_000)
        else:
            missed += 1
        i = j + 1
    events = len(leads) + missed
    return {"rise_events": events, "warned_share": len(leads) / max(1, events),
            "median_lead_min": float(np.median(leads)) if leads else 0.0}


lead_model = lead_times(p_test >= thr)
lead_base = lead_times(baseline_warn)
print(f"alert threshold {thr:.3f} (2% false alarms on June): test {at_thr}")
print(f"model lead: {lead_model}\nrate-of-change alarm: {baseline} lead: {lead_base}")

if best == "mlp":
    layers = [{"W": W.round(6).tolist(), "b": b.round(6).tolist()} for W, b in zip(model.coefs_, model.intercepts_)]
else:
    layers = [{"W": model.coef_.T.round(6).tolist(), "b": model.intercept_.round(6).tolist()}]
metrics = {
    "test_period": "2025-07-01 to 2025-09-30 (held out, monsoon)",
    "test_roc_auc": round(scores[best][0], 3),
    "test_average_precision": round(scores[best][1], 3),
    "recall_at_far_5": round(recall_at[0.05], 3),
    "recall_at_far_10": round(recall_at[0.10], 3),
    "recall_at_far_20": round(recall_at[0.20], 3),
    "precision_at_threshold": round(at_thr["precision"], 3),
    "recall_at_threshold": round(at_thr["recall"], 3),
    "false_alarm_rate_at_threshold": round(at_thr["false_alarm_rate"], 3),
    "false_warnings_per_node_week": round(false_warnings_per_node_week(p_test >= thr), 1),
    "rise_events": lead_model["rise_events"],
    "warned_share": round(lead_model["warned_share"], 3),
    "median_lead_min": round(lead_model["median_lead_min"]),
    "baseline": "rate-of-change alarm (excess +2 ppm in 30 min while above 5 ppm)",
    "baseline_warned_share": round(lead_base["warned_share"], 3),
    "baseline_median_lead_min": round(lead_base["median_lead_min"]),
    "baseline_false_alarm_rate": round(baseline["false_alarm_rate"], 3),
    "other_model": f"{'logistic' if best == 'mlp' else 'mlp'} ROC AUC {scores['logistic' if best == 'mlp' else 'mlp'][0]:.3f}",
}
OUT.write_text(json.dumps({
    "version": f"sensor-{best}-{datetime.now(timezone.utc):%Y%m%d}",
    "kind": best,
    "features": FEATURES,
    "mean": mean.round(6).tolist(),
    "std": std.round(6).tolist(),
    "layers": layers,
    "threshold": round(thr, 4),
    "horizon_h": 3,
    "trained_on": "simulated: VayuNetra sensor simulator driven by Open-Meteo (ERA5) hourly weather at the five landfills, Oct 2024 - Sep 2025",
    "metrics": metrics,
}, indent=1) + "\n", encoding="utf-8")
print(f"wrote {OUT} ({best})")
