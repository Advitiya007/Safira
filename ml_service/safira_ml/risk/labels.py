"""Label rules for the supervised incident dataset (P3). Read together with ML_PREDICTION_PROGRESS.md section 3.

One observation = (road segment, local calendar month, time band). Its label is decided ONLY from incident
records, the coverage manifest and geometry - never from infrastructure features (infrastructure-rich is not
safe, infrastructure-poor is not unsafe).

Incident classes (``classify_incidents``) - exactly one per incident, always recorded with a reason:

  positive_eligible              verified, in-scope category, time of day known, location error known and <= R,
                                 not a duplicate of another record  -> can create y = 1
  unresolved_pending             PENDING (unverified): never positive; makes nearby rows UNLABELLED, because the
                                 moderator may still verify it (a pending report is not "no incident")
  unresolved_location_uncertain  verified but location error unknown or > R: never positive; taints rows
  unresolved_time_of_day_unknown verified but only a date: never positive for a band; taints all bands of the month
  excluded_rejected              admin rejected: no effect at all (the admin decided it did not happen as reported)
  excluded_duplicate             same event as another record (see matching.mark_duplicates): no effect
  excluded_category_out_of_scope no effect
  SOS alarms never reach this module: ``sos`` is not an accepted source (see adapters.py).

Row label (``label_city``):

  y = 1  if >= 1 positive_eligible incident lies within R metres of the segment geometry in that month and band.
         ("nearest" mode: only the single nearest segment per incident; the other segments within R are
         unlabelled, so one incident is never read as proof that every nearby segment is unsafe.)
  y = 0  only if (a) a usable COMPLETE coverage window covers the whole month for this segment (city, period,
         optional bbox, geocoding precision <= R, and the window's source actually delivered records), and
         (b) nothing in rows below applies.
  else   unlabelled, with a reason:
         unlabelled_no_complete_coverage          (no usable complete window)
         unlabelled_pending_incident_nearby       } an unresolved/uncertain incident could affect this row:
         unlabelled_incident_time_of_day_unknown  } it is within R + its stated location error (or anywhere in
         unlabelled_incident_location_uncertain   } the city when the error is unknown) in this month/band
         unlabelled_location_guard_band           a positive incident lies in (R, R + its error]: the true
                                                  position may be within R, so 0 would be unsafe

Positive rows outside complete coverage are still written (y = 1) but flagged ``training_eligible = False``:
training on positives from places/periods where negatives cannot exist would teach the model "which places are
covered", not risk.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .config import RiskConfig
from .coverage import CoverageWindow
from .inspect import trainability_blockers
from .matching import BANDS, SegmentIndex, match_points, period_bounds_utc

# ---- incident decisions ---------------------------------------------------------------------------------------
D_POSITIVE = "positive_eligible"
D_PENDING = "unresolved_pending"
D_LOCATION = "unresolved_location_uncertain"
D_DATE_ONLY = "unresolved_time_of_day_unknown"
D_REJECTED = "excluded_rejected"
D_DUPLICATE = "excluded_duplicate"
D_CATEGORY = "excluded_category_out_of_scope"
ACTIVE = (D_POSITIVE, D_PENDING, D_LOCATION, D_DATE_ONLY)

# ---- row labels / reasons -------------------------------------------------------------------------------------
R_POSITIVE = "positive_verified_incident"
R_NEGATIVE = "negative_complete_coverage"
U_UNCOVERED = "unlabelled_no_complete_coverage"
U_PENDING = "unlabelled_pending_incident_nearby"
U_DATE_ONLY = "unlabelled_incident_time_of_day_unknown"
U_LOCATION = "unlabelled_incident_location_uncertain"
U_GUARD = "unlabelled_location_guard_band"
UNLABELLED_PRIORITY = (U_PENDING, U_DATE_ONLY, U_LOCATION, U_GUARD)   # attribution order when several apply
TRAIN_EXCLUDE_UNCOVERED_POSITIVE = "positive_outside_complete_coverage"

DECISION_TEXT = {
    D_POSITIVE: "verified, in scope, time of day known, location error <= radius",
    D_PENDING: "pending moderation: never a positive; neighbouring rows left unlabelled",
    D_LOCATION: "verified but location error unknown or larger than the match radius",
    D_DATE_ONLY: "verified but only a date is known (no time band)",
    D_REJECTED: "rejected by an admin",
    D_DUPLICATE: "duplicate of another record",
    D_CATEGORY: "category not in the configured scope",
}


class NotTrainableError(RuntimeError):
    """Raised by ``require_trainable``: a model must not be trained on this dataset."""


def classify_incidents(incidents: pd.DataFrame, config: RiskConfig) -> pd.DataFrame:
    """Add ``decision`` and ``decision_reason``. ``incidents`` must already have ``duplicate_of``."""
    out = incidents.copy()
    decisions = []
    for row in out.itertuples(index=False):
        error = row.location_error_m
        if row.verification == "rejected":
            decision = D_REJECTED
        elif row.duplicate_of:
            decision = D_DUPLICATE
        elif row.category not in config.incident_categories:
            decision = D_CATEGORY
        elif row.verification != "verified":
            decision = D_PENDING
        elif not (error == error and error <= config.label_radius_m):
            decision = D_LOCATION
        elif not row.time_known:
            decision = D_DATE_ONLY
        else:
            decision = D_POSITIVE
        decisions.append(decision)
    out["decision"] = decisions
    out["decision_reason"] = [DECISION_TEXT[d] + (f" ({dup})" if d == D_DUPLICATE else "")
                              for d, dup in zip(decisions, out.get("duplicate_of", [""] * len(out)))]
    return out


def window_id(position: int, window: CoverageWindow) -> str:
    return (f"W{position:03d}:{window.source}:{window.city_id}:{window.start:%Y%m%d}-{window.end:%Y%m%d}"
            + (":bbox" if window.bbox else ""))


@dataclass
class UsableWindow:
    wid: str
    window: CoverageWindow


def audit_windows(windows: list[CoverageWindow], incidents: pd.DataFrame, config: RiskConfig):
    """Split coverage windows into usable and unusable, recording why. A window is usable only if it is
    ``complete``, geocoded finely enough (<= R) and its source delivered at least one record for that city inside
    the window (a declaration of completeness without any data from that source is not evidence of coverage)."""
    usable, audit = [], []
    for position, window in enumerate(windows):
        wid = window_id(position, window)
        reason = None
        delivered = 0
        if len(incidents):
            delivered = int(((incidents["source"] == window.source) & (incidents["city_id"] == window.city_id)
                             & (incidents["occurred_at_utc"] >= window.start)
                             & (incidents["occurred_at_utc"] < window.end)).sum())
        if not window.complete:
            reason = "declared_incomplete"
        elif window.location_error_m > config.label_radius_m:
            reason = f"geocoding_error_{window.location_error_m:g}m_exceeds_radius_{config.label_radius_m:g}m"
        elif delivered == 0:
            reason = "no_records_from_this_source_in_this_city_and_window"
        audit.append({"id": wid, "source": window.source, "cityId": window.city_id, "start": str(window.start),
                      "end": str(window.end), "complete": window.complete,
                      "locationErrorM": window.location_error_m, "bbox": window.bbox,
                      "recordsDeliveredInWindow": delivered, "usable": reason is None,
                      "unusableReason": reason, "notes": window.notes})
        if reason is None:
            usable.append(UsableWindow(wid, window))
    return usable, audit


def _covered(index: SegmentIndex, usable: list[UsableWindow], city_id: str, period: str):
    """(bool mask of segments coverable this month, object array of covering window ids)."""
    n = len(index.frame)
    mask, ids = np.zeros(n, bool), np.full(n, "", dtype=object)
    start, end = period_bounds_utc(period, city_id)
    for item in usable:
        w = item.window
        if w.city_id != city_id or not (w.start <= start and end <= w.end):
            continue
        if w.bbox is None:
            inside = np.ones(n, bool)
        else:
            b = index.bounds_wgs
            inside = ((b[:, 0] >= w.bbox["west"]) & (b[:, 2] <= w.bbox["east"])
                      & (b[:, 1] >= w.bbox["south"]) & (b[:, 3] <= w.bbox["north"]))
        ids[inside] = np.where(ids[inside] == "", item.wid, ids[inside] + ";" + item.wid)
        mask |= inside
    return mask, ids


@dataclass
class CityResult:
    city_id: str
    rows: list = field(default_factory=list)            # DataFrames, one per month with labelled rows
    counts: Counter = field(default_factory=Counter)    # observation counts by outcome
    matches: list = field(default_factory=list)         # audit rows (incident x segment)
    incident_effects: dict = field(default_factory=lambda: defaultdict(Counter))
    months: list = field(default_factory=list)


def run_city(index: SegmentIndex, incidents: pd.DataFrame, usable: list[UsableWindow], months: list[str],
             config: RiskConfig, feature_columns: list[str], data_origin: str = "real",
             sink=None) -> CityResult:
    """Label every month of one city. ``sink(month, DataFrame)`` receives each month's labelled rows (so large
    cities are never held in memory at once); without a sink the frames are kept on the result."""
    city_id, radius = index.city_id, config.label_radius_m
    result = CityResult(city_id=city_id, months=list(months))
    n = len(index.frame)
    keys = index.frame["segment_key"].astype(str).to_numpy()
    active = incidents[(incidents["city_id"] == city_id) & incidents["decision"].isin(ACTIVE)].reset_index(drop=True)

    # --- spatial matching for every active incident with a known error (one query for the whole city) ---------
    known = active["location_error_m"].notna().to_numpy()
    reach = np.where(known, radius + active["location_error_m"].fillna(0).clip(lower=0).to_numpy(), np.nan)
    q_idx = np.flatnonzero(known)
    pi, si, dist = match_points(index, active["lon"].to_numpy()[q_idx], active["lat"].to_numpy()[q_idx], reach[q_idx])
    pi = q_idx[pi] if len(pi) else pi
    nearest_taken = {}
    if config.match_mode == "nearest":
        for p, s, d in zip(pi, si, dist):                      # sorted by distance then segment key
            if active.at[p, "decision"] == D_POSITIVE and d <= radius and p not in nearest_taken:
                nearest_taken[p] = s

    def effect_of(p, s, d):
        decision = active.at[p, "decision"]
        if decision == D_POSITIVE:
            if d <= radius and (config.match_mode == "radius" or nearest_taken.get(p) == s):
                return "positive"
            return "guard"
        return {D_PENDING: "taint_pending", D_LOCATION: "taint_location", D_DATE_ONLY: "taint_date_only"}[decision]

    by_month: dict[str, list] = defaultdict(list)
    for p, s, d in zip(pi, si, dist):
        by_month[active.at[p, "period"]].append((p, s, float(d), effect_of(p, s, float(d))))
    citywide: dict[str, list] = defaultdict(list)
    for p in np.flatnonzero(~known):
        citywide[active.at[p, "period"]].append(p)

    band_pos = {b: i for i, b in enumerate(BANDS)}
    for period in months:
        covered, cover_ids = _covered(index, usable, city_id, period)
        events, cw = by_month.get(period, []), citywide.get(period, [])
        pos = np.zeros((len(BANDS), n), bool)
        cnt = np.zeros((len(BANDS), n), int)
        mind = np.full((len(BANDS), n), np.inf)
        taint = {r: np.zeros((len(BANDS), n), bool) for r in UNLABELLED_PRIORITY}
        pos_ids: dict = defaultdict(list)
        pos_src: dict = defaultdict(set)
        for p, s, d, effect in events:
            row = active.loc[p]
            bands = [band_pos[row["band"]]] if row["band"] else range(len(BANDS))
            ikey = f'{row["source"]}:{row["incident_id"]}'
            if effect == "positive":
                b = bands[0]
                pos[b, s] = True
                cnt[b, s] += 1
                mind[b, s] = min(mind[b, s], d)
                pos_ids[(b, s)].append(row["incident_id"])
                pos_src[(b, s)].add(row["source"])
                result.incident_effects[ikey]["positive_segments"] += 1
                result.incident_effects[ikey]["positive_segments_in_complete_coverage"] += int(covered[s])
            else:
                reason = {"guard": U_GUARD, "taint_pending": U_PENDING, "taint_location": U_LOCATION,
                          "taint_date_only": U_DATE_ONLY}[effect]
                for b in bands:
                    taint[reason][b, s] = True
                result.incident_effects[ikey]["guard_segments" if effect == "guard" else "taint_segments"] += 1
            result.matches.append({"incident_id": row["incident_id"], "source": row["source"],
                                   "city_id": city_id, "segment_key": keys[s], "distance_m": round(d, 2),
                                   "effect": effect, "period": period, "time_band": row["band"] or "all",
                                   "incident_decision": row["decision"]})
        for p in cw:                                           # error unknown: cannot bound where it happened
            row = active.loc[p]
            bands = [band_pos[row["band"]]] if row["band"] else range(len(BANDS))
            reason = {D_PENDING: U_PENDING, D_LOCATION: U_LOCATION, D_DATE_ONLY: U_DATE_ONLY,
                      D_POSITIVE: U_LOCATION}[row["decision"]]
            for b in bands:
                taint[reason][b, :] = True
            result.incident_effects[f'{row["source"]}:{row["incident_id"]}']["citywide_taint"] += 1

        any_taint = np.zeros((len(BANDS), n), bool)
        for arr in taint.values():
            any_taint |= arr
        neg = covered[None, :] & ~pos & ~any_taint
        labelled = pos | neg

        # --- counts (every observation of the month is accounted for exactly once) ---------------------------
        for b in range(len(BANDS)):
            result.counts[R_POSITIVE] += int(pos[b].sum())
            result.counts["positive_training_eligible"] += int((pos[b] & covered).sum())
            result.counts["positive_outside_complete_coverage"] += int((pos[b] & ~covered).sum())
            result.counts[R_NEGATIVE] += int(neg[b].sum())
            unl = ~labelled[b]
            result.counts[U_UNCOVERED] += int((unl & ~covered).sum())
            rest = unl & covered
            for reason in UNLABELLED_PRIORITY:
                hit = rest & taint[reason][b]
                result.counts[reason] += int(hit.sum())
                rest = rest & ~hit
        result.counts["observations_in_horizon"] += n * len(BANDS)

        if not labelled.any():
            continue
        frames = []
        for b, band in enumerate(BANDS):
            idx = np.flatnonzero(labelled[b])
            if not len(idx):
                continue
            seg = index.frame.iloc[idx]
            is_pos = pos[b, idx]
            part = pd.DataFrame({
                "observation_id": [f"{city_id}|{keys[i]}|{period}|{band}" for i in idx],
                "city_id": city_id, "segment_key": keys[idx], "period": period, "time_band": band,
                "label": is_pos.astype(int),
                "label_reason": np.where(is_pos, R_POSITIVE, R_NEGATIVE),
                "training_eligible": covered[idx],
                "training_exclusion_reason": np.where(covered[idx], "", TRAIN_EXCLUDE_UNCOVERED_POSITIVE),
                "coverage_status": np.where(covered[idx], "complete", "none"),
                "coverage_window_ids": cover_ids[idx],
                "incident_count": cnt[b, idx],
                "incident_ids": [";".join(pos_ids[(b, i)]) for i in idx],
                "incident_sources": [";".join(sorted(pos_src[(b, i)])) for i in idx],
                "nearest_incident_distance_m": np.where(is_pos, np.round(mind[b, idx], 2), np.nan),
                "match_radius_m": radius, "match_mode": config.match_mode, "data_origin": data_origin,
            })
            for column in feature_columns:
                part[column] = seg[column].to_numpy()
            frames.append(part)
        month_frame = pd.concat(frames, ignore_index=True)
        if sink:
            sink(period, month_frame)
        else:
            result.rows.append(month_frame)
    return result


def dataset_trainability(counts: dict, positives_by_city: dict, usable: list[UsableWindow], config: RiskConfig,
                         is_synthetic: bool, rows_written: int) -> list[str]:
    """Plain-language blockers. Empty list = the dataset may be handed to P4."""
    blockers = []
    if is_synthetic:
        blockers.append("Input contains SYNTHETIC test incidents: never train on this dataset.")
    if rows_written == 0:
        blockers.append("No real training dataset is available: no labelled observations could be produced.")
    blockers += trainability_blockers(positives_by_city, [u.window for u in usable], config)
    negatives = counts.get(R_NEGATIVE, 0)
    if rows_written and negatives < config.min_negative_rows:
        blockers.append(f"Only {negatives} negative observations inside complete coverage; need at least "
                        f"{config.min_negative_rows}.")
    return blockers


def require_trainable(manifest: dict) -> None:
    """Hard gate for P4: refuses to continue unless the dataset manifest says it is trainable."""
    if not manifest.get("trainable"):
        raise NotTrainableError("dataset is not trainable: " + " | ".join(manifest.get("blockers") or ["unknown"]))
