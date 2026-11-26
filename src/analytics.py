"""Probability, stochastic processes, and statistical inference engine for RoV owner analytics."""

from __future__ import annotations

import math
import sqlite3
from datetime import date, datetime, timedelta, timezone
from typing import Any


def _normal_cdf(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def _wilson_ci(k: int, n: int, z: float = 1.959963984540054) -> tuple[float, float, float]:
    """Return (rate_pct, ci_low_pct, ci_high_pct) using Wilson score interval (Wilson 1927)."""
    if n <= 0:
        return (0.0, 0.0, 0.0)
    p = k / n
    z2 = z * z
    denom = 1.0 + z2 / n
    center = (p + z2 / (2.0 * n)) / denom
    half = (z * math.sqrt((p * (1.0 - p) + z2 / (4.0 * n)) / n)) / denom
    lo = max(0.0, center - half) * 100.0
    hi = min(1.0, center + half) * 100.0
    return (round(p * 100.0, 1), round(lo, 1), round(hi, 1))


def _beta_posterior(k: int, n: int, alpha0: float = 1.0, beta0: float = 3.0) -> tuple[float, float]:
    """Conjugate Beta-Binomial posterior mean and SD (in percentage points)."""
    a = alpha0 + max(0, k)
    b = beta0 + max(0, n - k)
    total = a + b
    mean = a / total
    sd = math.sqrt((a * b) / (total * total * (total + 1.0)))
    return (round(mean * 100.0, 1), round(sd * 100.0, 1))


def _two_proportion_z_test(k1: int, n1: int, k2: int, n2: int) -> dict[str, Any]:
    """Two-sided pooled Z-test comparing proportion k1/n1 vs k2/n2."""
    if n1 <= 0 or n2 <= 0:
        return {"diff_pct": 0.0, "z_stat": 0.0, "p_value": 1.0, "significant_95": False}
    p1 = k1 / n1
    p2 = k2 / n2
    p_pool = (k1 + k2) / (n1 + n2)
    se = math.sqrt(max(0.0, p_pool * (1.0 - p_pool) * (1.0 / n1 + 1.0 / n2)))
    if se <= 1e-12:
        return {"diff_pct": round((p1 - p2) * 100.0, 1), "z_stat": 0.0, "p_value": 1.0, "significant_95": False}
    z = (p1 - p2) / se
    p_val = max(0.0, min(1.0, 2.0 * (1.0 - _normal_cdf(abs(z)))))
    return {
        "diff_pct": round((p1 - p2) * 100.0, 1),
        "z_stat": round(z, 2),
        "p_value": round(p_val, 4),
        "significant_95": p_val < 0.05,
    }


def _two_prop_power_and_required_n(
    k1: int,
    n1: int,
    k2: int,
    n2: int,
    mde: float = 0.10,
) -> dict[str, Any]:
    """Compute achieved statistical power and required N/arm (Kohavi et al. 2009/2020)."""
    z_alpha = 1.959963984540054
    z_beta_target = 0.8416212335729143
    if n1 <= 0 or n2 <= 0:
        return {
            "achieved_power_pct": 0.0,
            "required_n_per_arm_mde10": 384,
            "min_arm_n": min(n1, n2),
            "status": "underpowered_do_not_peek",
        }
    p1 = max(1e-4, min(1.0 - 1e-4, k1 / n1))
    p2 = max(1e-4, min(1.0 - 1e-4, k2 / n2))
    p_bar = 0.5 * (p1 + p2)
    se_diff = math.sqrt(p1 * (1.0 - p1) / n1 + p2 * (1.0 - p2) / n2)
    delta_obs = abs(p1 - p2)
    z_power = (delta_obs / se_diff - z_alpha) if se_diff > 1e-12 else -z_alpha
    power_pct = round(max(0.0, min(1.0, _normal_cdf(z_power))) * 100.0, 1)

    se_mde = math.sqrt(2.0 * p_bar * (1.0 - p_bar))
    se_alt = math.sqrt(p1 * (1.0 - p1) + p2 * (1.0 - p2))
    n_req = math.ceil(((z_alpha * se_mde + z_beta_target * se_alt) / max(0.01, mde)) ** 2)

    z_test = _two_proportion_z_test(k1, n1, k2, n2)
    if z_test["significant_95"]:
        status = "reliable_significant" if power_pct >= 80.0 else "significant_moderate_power"
    elif min(n1, n2) < n_req or power_pct < 80.0:
        status = "underpowered_do_not_peek"
    else:
        status = "no_material_effect"

    return {
        "achieved_power_pct": power_pct,
        "required_n_per_arm_mde10": int(n_req),
        "min_arm_n": int(min(n1, n2)),
        "p_value": z_test["p_value"],
        "status": status,
    }


def _average_ranks(values: list[float]) -> list[float]:
    n = len(values)
    indexed = sorted(enumerate(values), key=lambda x: x[1])
    ranks = [0.0] * n
    i = 0
    while i < n:
        j = i
        while j + 1 < n and indexed[j + 1][1] == indexed[i][1]:
            j += 1
        avg_rank = (i + j) / 2.0 + 1.0
        for t in range(i, j + 1):
            ranks[indexed[t][0]] = avg_rank
        i = j + 1
    return ranks


def _spearman_rho(xs: list[float], ys: list[float]) -> dict[str, Any]:
    n = len(xs)
    if n < 3 or len(ys) != n:
        return {"n": n, "rho": 0.0, "p_value": 1.0}
    rx = _average_ranks(xs)
    ry = _average_ranks(ys)
    mx = sum(rx) / n
    my = sum(ry) / n
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry, strict=True))
    dx = math.sqrt(sum((a - mx) ** 2 for a in rx))
    dy = math.sqrt(sum((b - my) ** 2 for b in ry))
    if dx <= 1e-12 or dy <= 1e-12:
        return {"n": n, "rho": 0.0, "p_value": 1.0}
    rho = max(-1.0, min(1.0, num / (dx * dy)))
    if abs(rho) >= 1.0 - 1e-9:
        p_val = 0.0
    else:
        z = math.atanh(rho) * math.sqrt(max(1, n - 3))
        p_val = max(0.0, min(1.0, 2.0 * (1.0 - _normal_cdf(abs(z)))))
    return {"n": n, "rho": round(rho, 3), "p_value": round(p_val, 4)}


def _gini_coefficient(values: list[float]) -> float:
    n = len(values)
    if n <= 1:
        return 0.0
    vals = sorted(max(0.0, v) for v in values)
    total = sum(vals)
    if total <= 0.0:
        return 0.0
    weighted = sum((idx + 1) * v for idx, v in enumerate(vals))
    return round(max(0.0, min(1.0, (2.0 * weighted) / (n * total) - (n + 1.0) / n)), 3)


def _estimate_histogram_quantiles(buckets: dict[str, int]) -> tuple[float, float]:
    """Estimate p50 and p95 (ms) via piecewise-linear interpolation over latency buckets."""
    bounds = [
        ("lat_lt_25ms", 0.0, 25.0),
        ("lat_25_100ms", 25.0, 100.0),
        ("lat_100_500ms", 100.0, 500.0),
        ("lat_gt_500ms", 500.0, 1500.0),
    ]
    total = sum(max(0, buckets.get(k, 0)) for k, _, _ in bounds)
    if total <= 0:
        return (0.0, 0.0)

    def _q(target_frac: float) -> float:
        target = target_frac * total
        cum = 0.0
        for k, lo, hi in bounds:
            cnt = float(max(0, buckets.get(k, 0)))
            if cum + cnt >= target and cnt > 0:
                frac = (target - cum) / cnt
                return round(lo + frac * (hi - lo), 1)
            cum += cnt
        return 1500.0

    return (_q(0.50), _q(0.95))


def _compute_markov_retention(client_dates: dict[str, set[str]], today_str: str) -> dict[str, Any]:
    """Compute Discrete-Time Markov Chain transitions, steady state & finite-horizon expectation (Pfeifer & Carraway 2000)."""
    try:
        today_dt = date.fromisoformat(today_str)
    except ValueError:
        today_dt = date.today()

    first_seen = {cid: min(days) for cid, days in client_dates.items() if days}
    min_date_str = min(first_seen.values()) if first_seen else today_str
    try:
        min_dt = date.fromisoformat(min_date_str)
    except ValueError:
        min_dt = today_dt

    span_days = max(0, (today_dt - min_dt).days)
    new_stay = new_leave = 0
    ret_stay = ret_leave = 0
    dormant_resurrect = dormant_stay = 0

    for cid, days in client_dates.items():
        if not days:
            continue
        fs_str = first_seen[cid]
        try:
            fs_dt = date.fromisoformat(fs_str)
        except ValueError:
            continue
        age_total = (today_dt - fs_dt).days
        for offset in range(max(0, age_total)):
            d_cur = (fs_dt + timedelta(days=offset)).isoformat()
            d_next = (fs_dt + timedelta(days=offset + 1)).isoformat()
            cur_active = d_cur in days
            next_active = d_next in days
            if offset == 0:
                if next_active:
                    new_stay += 1
                else:
                    new_leave += 1
            elif cur_active:
                if next_active:
                    ret_stay += 1
                else:
                    ret_leave += 1
            else:
                if next_active:
                    dormant_resurrect += 1
                else:
                    dormant_stay += 1

    n_new = new_stay + new_leave
    n_ret = ret_stay + ret_leave
    n_dorm = dormant_resurrect + dormant_stay

    p_new_ret = new_stay / n_new if n_new > 0 else 0.0
    p_ret_ret = ret_stay / n_ret if n_ret > 0 else 0.0
    p_dorm_ret = dormant_resurrect / n_dorm if n_dorm > 0 else 0.0

    # Absorbing active-streak duration: E[L] = 1 + p_new_ret / (1 - p_ret_ret)
    effective_p_ret = p_ret_ret if n_ret >= 3 else p_new_ret
    denom_churn = max(0.05, 1.0 - min(0.95, effective_p_ret))
    expected_streak_days = round(1.0 + p_new_ret / denom_churn, 2)
    half_life_days = round(math.log(0.5) / math.log(effective_p_ret), 2) if 0.0 < effective_p_ret < 1.0 else None

    # Steady-state equilibrium of ergodic {Active, Dormant} subchain
    churn_prob = max(0.0, 1.0 - effective_p_ret)
    denom_ss = churn_prob + p_dorm_ret
    pi_active = (p_dorm_ret / denom_ss) if denom_ss > 1e-9 else 0.0

    # 14-day finite-horizon expected active days starting from New on day 0: v_{t+1} = v_t @ P
    # States: [Active, Dormant]; day 0 is Active = 1.0 (acquired), step 1 uses p_new_ret
    exp_active_14d = 1.0
    if n_new > 0:
        p_act = p_new_ret
        exp_active_14d += p_act
        for _ in range(2, 14):
            p_act = p_act * effective_p_ret + (1.0 - p_act) * p_dorm_ret
            exp_active_14d += p_act

    matrix_3x3 = [
        {
            "from_state": "New (D0)",
            "sample": n_new,
            "to_new_pct": 0.0,
            "to_active_pct": round(p_new_ret * 100.0, 1),
            "to_dormant_pct": round((1.0 - p_new_ret) * 100.0, 1) if n_new > 0 else 0.0,
        },
        {
            "from_state": "Active (D1+)",
            "sample": n_ret,
            "to_new_pct": 0.0,
            "to_active_pct": round(p_ret_ret * 100.0, 1),
            "to_dormant_pct": round((1.0 - p_ret_ret) * 100.0, 1) if n_ret > 0 else 0.0,
        },
        {
            "from_state": "Dormant",
            "sample": n_dorm,
            "to_new_pct": 0.0,
            "to_active_pct": round(p_dorm_ret * 100.0, 1),
            "to_dormant_pct": round((1.0 - p_dorm_ret) * 100.0, 1) if n_dorm > 0 else 0.0,
        },
    ]

    # Cohort retention curve S(k): % of eligible clients observed revisiting >= day k
    max_k = min(7, span_days)
    survival_curve = []
    for k in range(max_k + 1):
        eligible = 0
        survived = 0
        for cid, days in client_dates.items():
            try:
                fs_dt = date.fromisoformat(first_seen[cid])
            except ValueError:
                continue
            if (today_dt - fs_dt).days < k:
                continue
            eligible += 1
            cutoff_str = (fs_dt + timedelta(days=k)).isoformat()
            if k == 0 or any(d >= cutoff_str for d in days):
                survived += 1
        pct = round((survived / eligible) * 100.0, 1) if eligible > 0 else 0.0
        survival_curve.append({"day": k, "eligible": eligible, "survived": survived, "pct": pct})

    return {
        "transitions": {
            "new_to_active_pct": round(p_new_ret * 100.0, 1),
            "new_sample": n_new,
            "retained_to_active_pct": round(p_ret_ret * 100.0, 1),
            "retained_sample": n_ret,
            "dormant_to_resurrect_pct": round(p_dorm_ret * 100.0, 1),
            "dormant_sample": n_dorm,
        },
        "matrix_3x3": matrix_3x3,
        "steady_state_active_pct": round(pi_active * 100.0, 1),
        "steady_state_dormant_pct": round((1.0 - pi_active) * 100.0, 1),
        "expected_active_days_14d": round(exp_active_14d, 2),
        "expected_active_streak_days": expected_streak_days,
        "retention_half_life_days": half_life_days,
        "survival_curve": survival_curve,
    }


def _kaplan_meier_curve(dates_list: list[set[str]], today_dt: date, max_day: int = 14) -> list[dict[str, Any]]:
    """Nonparametric Kaplan-Meier retention survival S(t) with Greenwood 95% CI (Kaplan & Meier 1958)."""
    observations: list[tuple[int, bool]] = []
    for days in dates_list:
        if not days:
            continue
        try:
            first_dt = date.fromisoformat(min(days))
            last_dt = date.fromisoformat(max(days))
        except ValueError:
            continue
        tenure = max(0, (today_dt - first_dt).days)
        last_offset = max(0, (last_dt - first_dt).days)
        trailing_silence = max(0, (today_dt - last_dt).days)
        # Non-contractual right-censoring rule: silent <= 1 day is still under active observation (censored)
        if trailing_silence >= 2:
            observations.append((last_offset + 1, True))
        else:
            observations.append((tenure + 1, False))

    if not observations:
        return []

    max_obs_day = max(t for t, _ in observations)
    horizon = min(max_day, max(0, max_obs_day))
    curve: list[dict[str, Any]] = []
    s_t = 1.0
    greenwood_sum = 0.0

    for k in range(horizon + 1):
        at_risk = sum(1 for t, _ in observations if t >= k)
        events = sum(1 for t, is_evt in observations if is_evt and t == k)
        if at_risk <= 0:
            break
        if events > 0:
            s_t *= 1.0 - (events / at_risk)
            if at_risk > events:
                greenwood_sum += events / (at_risk * (at_risk - events))
        se = s_t * math.sqrt(greenwood_sum) if greenwood_sum > 0.0 else 0.0
        lo = max(0.0, s_t - 1.959963984540054 * se) * 100.0
        hi = min(1.0, s_t + 1.959963984540054 * se) * 100.0
        curve.append(
            {
                "day": k,
                "at_risk": at_risk,
                "events": events,
                "survival_pct": round(s_t * 100.0, 1),
                "ci_low": round(lo, 1),
                "ci_high": round(hi, 1),
            }
        )
    return curve


def _calibrate_btyd_params(
    client_dates: dict[str, set[str]], today_dt: date, p_ret_fallback: float
) -> dict[str, float]:
    """Calibrate BG/NBD-inspired empirical parameters via Method-of-Moments (Fader, Hardie & Lee 2005)."""
    rates: list[float] = []
    for days in client_dates.values():
        if not days:
            continue
        try:
            fs_dt = date.fromisoformat(min(days))
        except ValueError:
            continue
        tenure = (today_dt - fs_dt).days
        if tenure >= 1:
            x = max(0, len(days) - 1)
            rates.append(x / tenure)

    mean_rate = (sum(rates) / len(rates)) if rates else 0.15
    var_rate = (sum((r - mean_rate) ** 2 for r in rates) / max(1, len(rates) - 1)) if len(rates) > 1 else 0.05
    if mean_rate > 1e-4 and var_rate > mean_rate * 1e-2:
        r_shape = max(0.35, min(1.5, (mean_rate * mean_rate) / max(1e-4, var_rate)))
    else:
        r_shape = 0.65
    alpha_scale = max(0.75, min(14.0, r_shape / max(0.08, mean_rate)))

    churn_prob = max(0.15, min(0.92, 1.0 - p_ret_fallback))
    a_bg = 1.0
    b_bg = max(0.25, (1.0 - churn_prob) / churn_prob)
    return {"r_shape": r_shape, "alpha_scale": alpha_scale, "a_bg": a_bg, "b_bg": b_bg}


def _bg_nbd_p_alive(x: int, t_x: int, tenure: int, params: dict[str, float]) -> float:
    """Compute P(Alive | x, t_x, T) using BG/NBD posterior hazard formulation (Fader et al. 2005)."""
    if tenure <= 0:
        return 1.0
    r_shape = params["r_shape"]
    alpha_scale = params["alpha_scale"]
    a_bg = params["a_bg"]
    b_bg = params["b_bg"]

    if x <= 0:
        ratio_zero = (alpha_scale / (alpha_scale + tenure)) ** r_shape
        base_alive = 1.0 / (1.0 + a_bg / b_bg)
        return max(0.01, min(0.99, ratio_zero * base_alive))

    ratio = (alpha_scale + tenure) / (alpha_scale + max(0, t_x))
    exponent = min(25.0, r_shape + x)
    # Guard math.pow overflow for extreme ratios
    log_term = exponent * math.log(max(1.0, ratio))
    if log_term > 30.0:
        return 0.0
    hazard_factor = (a_bg / max(0.1, b_bg + x - 1.0)) * math.exp(log_term)
    return max(0.0, min(1.0, 1.0 / (1.0 + hazard_factor)))


def _gamma_poisson_forecast(daily_counts: list[int], alpha0: float = 2.0, beta0: float = 0.05) -> dict[str, Any]:
    """Conjugate Gamma-Poisson predictive rate and 95% predictive interval."""
    n = len(daily_counts)
    total = sum(max(0, c) for c in daily_counts)
    post_a = alpha0 + total
    post_b = beta0 + max(1, n)
    lam = post_a / post_b
    pred_var = lam + (lam * lam) / max(1.0, post_a)
    pred_sd = math.sqrt(pred_var)
    lo = max(0, math.floor(lam - 1.96 * pred_sd))
    hi = math.ceil(lam + 1.96 * pred_sd)
    return {
        "observed_days": n,
        "expected_next_day": round(lam, 1),
        "ci_low": lo,
        "ci_high": hi,
    }


def _compute_behavioral_signals(user_records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Evaluate behavioral feature-to-WTP Spearman correlations & lifts (Sifa et al. 2015)."""
    respondents = [r for r in user_records if r["willing"] is not None]
    if not respondents:
        return []

    ys = [1.0 if r["willing"] else 0.0 for r in respondents]
    specs = [
        ("active_days", "Active Days (>= 2d)", lambda r: float(r["active_days"]), lambda r: r["active_days"] >= 2),
        (
            "predict_calls",
            "AI Predict Calls (>= 5)",
            lambda r: float(r["predict_calls"]),
            lambda r: r["predict_calls"] >= 5,
        ),
        ("draft_games", "Saved Draft Games (>= 1)", lambda r: float(r["draft_games"]), lambda r: r["draft_games"] >= 1),
        (
            "practice_games",
            "Practice vs AI (>= 1)",
            lambda r: float(r["practice_games"]),
            lambda r: r["practice_games"] >= 1,
        ),
        (
            "oauth_linked",
            "OAuth Linked (Google/Discord)",
            lambda r: float(r["oauth_linked"]),
            lambda r: r["oauth_linked"] == 1,
        ),
        ("tenure_days", "Account Age (>= 1d)", lambda r: float(r["tenure_days"]), lambda r: r["tenure_days"] >= 1),
    ]

    signals: list[dict[str, Any]] = []
    for key, label, val_fn, split_fn in specs:
        xs = [val_fn(r) for r in respondents]
        sp = _spearman_rho(xs, ys)
        hi_group = [r for r in respondents if split_fn(r)]
        lo_group = [r for r in respondents if not split_fn(r)]
        hi_pct = round(sum(1 for r in hi_group if r["willing"]) / len(hi_group) * 100.0, 1) if hi_group else 0.0
        lo_pct = round(sum(1 for r in lo_group if r["willing"]) / len(lo_group) * 100.0, 1) if lo_group else 0.0
        lift = round(hi_pct / lo_pct, 2) if hi_group and lo_group and lo_pct > 0.0 else 0.0
        signals.append(
            {
                "key": key,
                "label": label,
                "rho": sp["rho"],
                "p_value": sp["p_value"],
                "high_n": len(hi_group),
                "high_wtp_pct": hi_pct,
                "low_n": len(lo_group),
                "low_wtp_pct": lo_pct,
                "lift": lift,
            }
        )
    signals.sort(key=lambda s: abs(float(s["rho"])), reverse=True)
    return signals


def build_statistical_analytics(conn: sqlite3.Connection, today_str: str) -> dict[str, Any]:
    """Compute all probabilistic, stochastic, and statistical metrics from SQLite."""
    try:
        today_dt = date.fromisoformat(today_str)
    except ValueError:
        today_dt = date.today()

    # 1. Per-client daily_visits for Markov retention, Kaplan-Meier, BTYD P(Alive) & Member-vs-Guest RR
    visit_rows = conn.execute("SELECT client_id, visit_date, user_id, predict_count FROM daily_visits").fetchall()
    client_dates: dict[str, set[str]] = {}
    client_is_member: dict[str, bool] = {}
    user_visit_dates: dict[int, set[str]] = {}
    daily_dau_map: dict[str, int] = {}

    for r in visit_rows:
        cid = str(r["client_id"])
        vd = str(r["visit_date"])
        client_dates.setdefault(cid, set()).add(vd)
        if r["user_id"] is not None:
            uid = int(r["user_id"])
            client_is_member[cid] = True
            user_visit_dates.setdefault(uid, set()).add(vd)
        else:
            client_is_member.setdefault(cid, False)
        daily_dau_map[vd] = daily_dau_map.get(vd, 0) + 1

    # Merge user_usage_daily dates into user_visit_dates so registered users' activity history is complete
    for ur in conn.execute("SELECT user_id, usage_date FROM user_usage_daily").fetchall():
        user_visit_dates.setdefault(int(ur["user_id"]), set()).add(str(ur["usage_date"]))

    markov_retention = _compute_markov_retention(client_dates, today_str)

    # Member vs Guest returning Relative Risk (active_days >= 2)
    mem_clients = [cid for cid, is_m in client_is_member.items() if is_m]
    gst_clients = [cid for cid, is_m in client_is_member.items() if not is_m]
    k_mem = sum(1 for cid in mem_clients if len(client_dates[cid]) >= 2)
    k_gst = sum(1 for cid in gst_clients if len(client_dates[cid]) >= 2)
    n_mem = len(mem_clients)
    n_gst = len(gst_clients)
    mem_rate, mem_lo, mem_hi = _wilson_ci(k_mem, n_mem)
    gst_rate, gst_lo, gst_hi = _wilson_ci(k_gst, n_gst)
    z_rr = _two_proportion_z_test(k_mem, n_mem, k_gst, n_gst)
    if k_mem > 0 and k_gst > 0 and n_mem > 0 and n_gst > 0:
        rr = (k_mem / n_mem) / (k_gst / n_gst)
        se_log_rr = math.sqrt((1.0 / k_mem - 1.0 / n_mem) + (1.0 / k_gst - 1.0 / n_gst))
        rr_lo = math.exp(math.log(rr) - 1.96 * se_log_rr)
        rr_hi = math.exp(math.log(rr) + 1.96 * se_log_rr)
    else:
        rr = (k_mem / n_mem) / (k_gst / n_gst) if n_mem > 0 and k_gst > 0 and n_gst > 0 else 0.0
        rr_lo = rr_hi = rr

    member_vs_guest_retention = {
        "member": {"n": n_mem, "returning": k_mem, "rate_pct": mem_rate, "ci_95": [mem_lo, mem_hi]},
        "guest": {"n": n_gst, "returning": k_gst, "rate_pct": gst_rate, "ci_95": [gst_lo, gst_hi]},
        "relative_risk": round(rr, 2),
        "rr_ci_95": [round(rr_lo, 2), round(rr_hi, 2)],
        "p_value": z_rr["p_value"],
        "significant_95": z_rr["significant_95"],
    }

    # Kaplan-Meier nonparametric survival curves (Member vs Guest + Overall)
    kaplan_meier_survival = {
        "overall": _kaplan_meier_curve(list(client_dates.values()), today_dt),
        "member": _kaplan_meier_curve([client_dates[cid] for cid in mem_clients], today_dt),
        "guest": _kaplan_meier_curve([client_dates[cid] for cid in gst_clients], today_dt),
    }

    # BTYD P(Alive) segmentation across tracked clients (Fader, Hardie & Lee 2005, 2009)
    p_ret_fallback = (
        markov_retention["transitions"]["retained_to_active_pct"] / 100.0
        if markov_retention["transitions"]["retained_sample"] >= 3
        else markov_retention["transitions"]["new_to_active_pct"] / 100.0
    )
    btyd_params = _calibrate_btyd_params(client_dates, today_dt, p_ret_fallback=max(0.05, p_ret_fallback))
    seg_counts = {"new_today": 0, "active_core": 0, "slipping": 0, "dormant": 0}
    expected_alive_sum = 0.0
    expected_7d_visits = 0.0
    mem_alive_vals: list[float] = []
    gst_alive_vals: list[float] = []

    for cid, days in client_dates.items():
        if not days:
            continue
        try:
            fs_dt = date.fromisoformat(min(days))
            ls_dt = date.fromisoformat(max(days))
        except ValueError:
            continue
        tenure = max(0, (today_dt - fs_dt).days)
        t_x = max(0, (ls_dt - fs_dt).days)
        x = max(0, len(days) - 1)
        p_alive = _bg_nbd_p_alive(x, t_x, tenure, btyd_params)
        expected_alive_sum += p_alive
        rate_i = (x + btyd_params["r_shape"]) / (tenure + btyd_params["alpha_scale"])
        expected_7d_visits += p_alive * rate_i * 7.0
        if client_is_member.get(cid):
            mem_alive_vals.append(p_alive)
        else:
            gst_alive_vals.append(p_alive)

        if tenure == 0:
            seg_counts["new_today"] += 1
        elif p_alive >= 0.70:
            seg_counts["active_core"] += 1
        elif p_alive >= 0.30:
            seg_counts["slipping"] += 1
        else:
            seg_counts["dormant"] += 1

    btyd_alive = {
        "total_clients": len(client_dates),
        "expected_alive_clients": round(expected_alive_sum, 1),
        "expected_7d_repeat_visits": round(expected_7d_visits, 1),
        "member_avg_p_alive_pct": round((sum(mem_alive_vals) / len(mem_alive_vals)) * 100.0, 1)
        if mem_alive_vals
        else 0.0,
        "guest_avg_p_alive_pct": round((sum(gst_alive_vals) / len(gst_alive_vals)) * 100.0, 1)
        if gst_alive_vals
        else 0.0,
        "segments": seg_counts,
        "params": {k: round(v, 3) for k, v in btyd_params.items()},
    }

    # 2. User usage, Bayesian WTP segmentation, Behavioral Signals & per-user P(Alive)
    user_rows = conn.execute(
        """
        WITH visit_agg AS (
            SELECT user_id, COUNT(DISTINCT visit_date) AS active_days
            FROM daily_visits
            WHERE user_id IS NOT NULL
            GROUP BY user_id
        ),
        usage_agg AS (
            SELECT user_id, COALESCE(SUM(predict_count), 0) AS predict_calls
            FROM user_usage_daily
            GROUP BY user_id
        )
        SELECT
            u.id,
            u.created_at,
            EXISTS(SELECT 1 FROM user_oauth_accounts oa WHERE oa.user_id = u.id) AS oauth_linked,
            COALESCE(va.active_days, 0) AS active_days,
            COALESCE(ua.predict_calls, 0) AS predict_calls,
            COALESCE(json_array_length(json_extract(ds.payload_json, '$.seriesGames')), 0) AS draft_games,
            COALESCE(json_array_length(json_extract(ph.payload_json, '$.entries')), 0) AS practice_games,
            ps.choice AS survey_choice
        FROM users u
        LEFT JOIN visit_agg va ON va.user_id = u.id
        LEFT JOIN usage_agg ua ON ua.user_id = u.id
        LEFT JOIN user_draft_states ds ON ds.user_id = u.id
        LEFT JOIN user_practice_histories ph ON ph.user_id = u.id
        LEFT JOIN pricing_survey_responses ps ON ps.user_id = u.id
        """
    ).fetchall()

    guest_survey_row = conn.execute(
        """
        SELECT
            COUNT(*) AS n,
            COALESCE(SUM(CASE WHEN choice = 'willing' THEN 1 ELSE 0 END), 0) AS k_will
        FROM pricing_survey_responses
        WHERE is_guest = 1
        """
    ).fetchone()

    eng_w = eng_n = cas_w = cas_n = 0
    mem_w = mem_n = 0
    will_ret = will_tot = nowill_ret = nowill_tot = 0
    spearman_x: list[float] = []
    spearman_y: list[float] = []
    games_per_user: list[float] = []
    behavioral_records: list[dict[str, Any]] = []
    user_btyd_scores: dict[str, dict[str, Any]] = {}
    tz_th = timezone(timedelta(hours=7))

    for r in user_rows:
        uid = int(r["id"])
        active_days = int(r["active_days"] or 0)
        predict_calls = int(r["predict_calls"] or 0)
        draft_games = int(r["draft_games"] or 0)
        practice_games = int(r["practice_games"] or 0)
        total_games = draft_games + practice_games
        oauth_linked = 1 if int(r["oauth_linked"] or 0) > 0 else 0
        created_dt = datetime.fromtimestamp(int(r["created_at"] or 0), tz_th).date()
        tenure_days = max(0, (today_dt - created_dt).days)
        games_per_user.append(float(total_games))

        u_days = user_visit_dates.get(uid, set())
        if u_days:
            try:
                u_first = date.fromisoformat(min(u_days))
                u_last = date.fromisoformat(max(u_days))
                u_tenure = max(tenure_days, (today_dt - u_first).days)
                u_tx = max(0, (u_last - u_first).days)
                u_x = max(0, len(u_days) - 1)
            except ValueError:
                u_tenure, u_tx, u_x = tenure_days, 0, max(0, active_days - 1)
        else:
            u_tenure, u_tx, u_x = tenure_days, 0, max(0, active_days - 1)

        p_alive_u = _bg_nbd_p_alive(u_x, u_tx, u_tenure, btyd_params)
        if u_tenure == 0 and u_x == 0:
            tier = "New"
        elif p_alive_u >= 0.70:
            tier = "Core"
        elif p_alive_u >= 0.30:
            tier = "At-Risk"
        else:
            tier = "Dormant"

        behavior_score = min(
            100,
            round(
                min(40.0, math.log1p(active_days) * 20.0)
                + min(30.0, math.log1p(total_games) * 14.0)
                + min(25.0, math.log1p(predict_calls) * 7.0)
                + oauth_linked * 5.0
            ),
        )
        user_btyd_scores[str(uid)] = {
            "p_alive_pct": round(p_alive_u * 100.0, 1),
            "btyd_tier": tier,
            "behavior_score": int(behavior_score),
        }

        is_engaged = active_days >= 2 or total_games >= 1 or predict_calls >= 10
        choice = r["survey_choice"]
        is_will_opt: bool | None = None
        if choice in {"willing", "not_willing"}:
            is_will = choice == "willing"
            is_will_opt = is_will
            mem_n += 1
            if is_will:
                mem_w += 1
                will_tot += 1
                if is_engaged:
                    will_ret += 1
            else:
                nowill_tot += 1
                if is_engaged:
                    nowill_ret += 1
            if is_engaged:
                eng_n += 1
                if is_will:
                    eng_w += 1
            else:
                cas_n += 1
                if is_will:
                    cas_w += 1
            eng_score = active_days * 3.0 + total_games * 2.0 + min(predict_calls, 50) * 0.2
            spearman_x.append(eng_score)
            spearman_y.append(1.0 if is_will else 0.0)

        behavioral_records.append(
            {
                "active_days": active_days,
                "predict_calls": predict_calls,
                "draft_games": draft_games,
                "practice_games": practice_games,
                "tenure_days": tenure_days,
                "oauth_linked": oauth_linked,
                "willing": is_will_opt,
            }
        )

    def _seg_dict(k: int, n: int) -> dict[str, Any]:
        emp, lo, hi = _wilson_ci(k, n)
        post_mean, post_sd = _beta_posterior(k, n, alpha0=1.0, beta0=3.0)
        return {
            "n": n,
            "willing": k,
            "empirical_pct": emp,
            "wilson_ci_95": [lo, hi],
            "bayes_posterior_pct": post_mean,
            "bayes_sd_pct": post_sd,
        }

    gst_n = int(guest_survey_row["n"] or 0)
    gst_w = int(guest_survey_row["k_will"] or 0)
    bayesian_wtp = {
        "prior": "Beta(1, 3) (25% baseline)",
        "engaged": _seg_dict(eng_w, eng_n),
        "casual": _seg_dict(cas_w, cas_n),
        "all_members": _seg_dict(mem_w, mem_n),
        "guests": _seg_dict(gst_w, gst_n),
        "engaged_vs_casual_test": _two_proportion_z_test(eng_w, eng_n, cas_w, cas_n),
        "willing_vs_not_willing_engaged_rate": {
            "willing_engaged_pct": round((will_ret / will_tot) * 100.0, 1) if will_tot > 0 else 0.0,
            "not_willing_engaged_pct": round((nowill_ret / nowill_tot) * 100.0, 1) if nowill_tot > 0 else 0.0,
            **_two_proportion_z_test(will_ret, will_tot, nowill_ret, nowill_tot),
        },
        "spearman_engagement_vs_wtp": _spearman_rho(spearman_x, spearman_y),
    }

    # 3. Usage Overdispersion, Gini & Pareto Concentration
    n_u = len(games_per_user)
    if n_u > 0:
        mean_g = sum(games_per_user) / n_u
        var_g = sum((v - mean_g) ** 2 for v in games_per_user) / max(1, n_u - 1) if n_u > 1 else 0.0
        dispersion = (var_g / mean_g) if mean_g > 0 else 0.0
        sorted_desc = sorted(games_per_user, reverse=True)
        total_g = sum(sorted_desc)
        top10_n = max(1, math.ceil(n_u * 0.10))
        top20_n = max(1, math.ceil(n_u * 0.20))
        top10_share = (sum(sorted_desc[:top10_n]) / total_g * 100.0) if total_g > 0 else 0.0
        top20_share = (sum(sorted_desc[:top20_n]) / total_g * 100.0) if total_g > 0 else 0.0
        active_players = sum(1 for v in games_per_user if v > 0)
    else:
        mean_g = var_g = dispersion = top10_share = top20_share = 0.0
        active_players = 0

    usage_distribution = {
        "total_users": n_u,
        "users_with_saved_games": active_players,
        "mean_games_per_user": round(mean_g, 2),
        "variance_games": round(var_g, 2),
        "dispersion_index": round(dispersion, 2),
        "process_regime": ("Overdispersed (Negative Binomial / Power-Law)" if dispersion > 1.5 else "Poisson-like"),
        "gini_coefficient": _gini_coefficient(games_per_user),
        "top_10pct_share_pct": round(top10_share, 1),
        "top_20pct_share_pct": round(top20_share, 1),
    }

    # 4. Daily telemetry events, Load Forecast, AI Trust & Latency Quantiles
    event_rows = conn.execute("SELECT event_date, metric_key, count FROM site_events_daily").fetchall()
    totals: dict[str, int] = {}
    daily_predict_map: dict[str, int] = {}
    for r in event_rows:
        ed = str(r["event_date"])
        mk = str(r["metric_key"])
        cnt = int(r["count"] or 0)
        totals[mk] = totals.get(mk, 0) + cnt
        if mk in {"predict_member", "predict_guest"}:
            daily_predict_map[ed] = daily_predict_map.get(ed, 0) + cnt

    completed_dau_vals = [cnt for d, cnt in sorted(daily_dau_map.items()) if d < today_str] or list(
        daily_dau_map.values()
    )
    completed_pred_vals = [cnt for d, cnt in sorted(daily_predict_map.items()) if d < today_str] or list(
        daily_predict_map.values()
    )
    load_forecast = {
        "dau_next_day": _gamma_poisson_forecast(completed_dau_vals),
        "predicts_next_day": _gamma_poisson_forecast(completed_pred_vals) if completed_pred_vals else None,
    }

    t1 = totals.get("ai_adopt_top1", 0)
    t2_5 = totals.get("ai_adopt_top2_5", 0)
    t6_10 = totals.get("ai_adopt_top6_10", 0)
    off = totals.get("ai_adopt_offmeta", 0)
    n_picks = t1 + t2_5 + t6_10 + off
    top5_cnt = t1 + t2_5
    top10_cnt = top5_cnt + t6_10
    p0_top5 = 5.0 / 130.0
    if n_picks > 0:
        se_p0 = math.sqrt(p0_top5 * (1.0 - p0_top5) / n_picks)
        z_top5 = ((top5_cnt / n_picks) - p0_top5) / se_p0 if se_p0 > 0 else 0.0
        p_top5 = max(0.0, min(1.0, 2.0 * (1.0 - _normal_cdf(abs(z_top5)))))
    else:
        z_top5 = 0.0
        p_top5 = 1.0
    top5_rate, top5_lo, top5_hi = _wilson_ci(top5_cnt, n_picks)
    top5_bayes, _ = _beta_posterior(top5_cnt, n_picks, alpha0=1.0, beta0=1.0)

    ai_trust = {
        "total_logged_picks": n_picks,
        "top1_count": t1,
        "top2_5_count": t2_5,
        "top6_10_count": t6_10,
        "offmeta_count": off,
        "top1_pct": round((t1 / n_picks) * 100.0, 1) if n_picks > 0 else 0.0,
        "top5_pct": top5_rate,
        "top5_wilson_ci_95": [top5_lo, top5_hi],
        "top5_bayes_posterior_pct": top5_bayes,
        "top10_pct": round((top10_cnt / n_picks) * 100.0, 1) if n_picks > 0 else 0.0,
        "random_top5_baseline_pct": round(p0_top5 * 100.0, 2),
        "binomial_z_vs_random": round(z_top5, 2),
        "p_value": round(p_top5, 4),
    }

    lat_count = totals.get("predict_lat_count", 0)
    lat_sum = totals.get("predict_lat_sum_ms", 0)
    p50_ms, p95_ms = _estimate_histogram_quantiles(totals)
    latency = {
        "total_requests": lat_count,
        "mean_ms": round(lat_sum / lat_count, 1) if lat_count > 0 else 0.0,
        "p50_ms": p50_ms,
        "p95_ms": p95_ms,
        "lookahead_count": totals.get("predict_lookahead_count", 0),
        "buckets": {
            "lt_25ms": totals.get("lat_lt_25ms", 0),
            "ms_25_100": totals.get("lat_25_100ms", 0),
            "ms_100_500": totals.get("lat_100_500ms", 0),
            "gt_500ms": totals.get("lat_gt_500ms", 0),
        },
    }

    pred_mem = totals.get("predict_member", 0)
    pred_gst = totals.get("predict_guest", 0)
    pred_tot = pred_mem + pred_gst
    guest_vs_member_predicts = {
        "member": pred_mem,
        "guest": pred_gst,
        "total": pred_tot,
        "member_share_pct": round((pred_mem / pred_tot) * 100.0, 1) if pred_tot > 0 else 0.0,
        "guest_share_pct": round((pred_gst / pred_tot) * 100.0, 1) if pred_tot > 0 else 0.0,
    }

    feature_usage = {
        "draft_started": totals.get("draft_started", 0),
        "draft_completed_18": totals.get("draft_completed_18", 0),
        "practice_started": totals.get("practice_started", 0),
        "practice_completed_18": totals.get("practice_completed_18", 0),
        "devices": {
            "mobile": totals.get("device_mobile", 0),
            "desktop": totals.get("device_desktop", 0),
        },
        "tabs": {
            "practice": totals.get("tab_practice", 0),
            "analytics": totals.get("tab_analytics", 0),
            "plans": totals.get("tab_plans", 0),
            "profile": totals.get("tab_profile", 0),
        },
        "funnel": {
            "auth_skip_guest": totals.get("auth_skip_guest", 0),
        },
        "leagues": {lg: totals.get(f"league_{lg}", 0) for lg in ("GLOBAL", "RPL", "GCS", "AOG", "INTL")},
        "practice_modes": {m: totals.get(f"mode_{m}", 0) for m in ("bo1", "bo3", "bo5", "bo7")},
        "tools": {
            "timer_start": totals.get("feat_timer_start", 0),
            "pick_lane": totals.get("feat_pick_lane", 0),
            "replace_hero": totals.get("feat_replace_hero", 0),
            "practice_hints_off": totals.get("feat_practice_hints_off", 0),
            "scouting_pdf": totals.get("feat_scouting_pdf", 0),
            "hero_pools": totals.get("feat_hero_pools", 0),
            "global_ban": totals.get("feat_global_ban", 0),
            "practice_history": totals.get("feat_practice_history", 0),
            "practice_review": totals.get("feat_practice_review", 0),
        },
    }

    behavioral_signals = _compute_behavioral_signals(behavioral_records)
    experiment_guardrails = {
        "member_vs_guest_retention": _two_prop_power_and_required_n(k_mem, n_mem, k_gst, n_gst, mde=0.10),
        "wtp_engaged_vs_casual": _two_prop_power_and_required_n(eng_w, eng_n, cas_w, cas_n, mde=0.10),
        "latency_sla": {
            "target_p95_ms": 500.0,
            "observed_p95_ms": p95_ms,
            "status": "no_data" if lat_count == 0 else ("pass" if p95_ms <= 500.0 else "warn"),
        },
    }

    return {
        "markov_retention": markov_retention,
        "kaplan_meier_survival": kaplan_meier_survival,
        "btyd_alive": btyd_alive,
        "bayesian_wtp": bayesian_wtp,
        "member_vs_guest_retention": member_vs_guest_retention,
        "usage_distribution": usage_distribution,
        "load_forecast": load_forecast,
        "ai_trust": ai_trust,
        "latency": latency,
        "guest_vs_member_predicts": guest_vs_member_predicts,
        "feature_usage": feature_usage,
        "behavioral_signals": behavioral_signals,
        "experiment_guardrails": experiment_guardrails,
        "user_btyd_scores": user_btyd_scores,
    }
