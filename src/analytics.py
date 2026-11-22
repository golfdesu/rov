"""Probability, stochastic processes, and statistical inference engine for RoV owner analytics."""

from __future__ import annotations

import math
import sqlite3
from datetime import date, timedelta
from typing import Any


def _normal_cdf(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def _wilson_ci(k: int, n: int, z: float = 1.959963984540054) -> tuple[float, float, float]:
    """Return (rate_pct, ci_low_pct, ci_high_pct) using Wilson score interval."""
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
    # Build observed 1-step daily transitions for d < today_dt
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

    # Empirical probabilities with weak Jeffreys smoothing only for fundamental expectation stability
    n_new = new_stay + new_leave
    n_ret = ret_stay + ret_leave
    n_dorm = dormant_resurrect + dormant_stay

    p_new_ret = new_stay / n_new if n_new > 0 else 0.0
    p_ret_ret = ret_stay / n_ret if n_ret > 0 else 0.0
    p_dorm_ret = dormant_resurrect / n_dorm if n_dorm > 0 else 0.0

    # Absorbing 2-state chain over active streak states [New, Retained]: E[L] = 1 + p_new_ret / (1 - p_ret_ret)
    effective_p_ret = p_ret_ret if n_ret >= 3 else p_new_ret
    denom_churn = max(0.05, 1.0 - min(0.95, effective_p_ret))
    expected_streak_days = round(1.0 + p_new_ret / denom_churn, 2)
    half_life_days = round(math.log(0.5) / math.log(effective_p_ret), 2) if 0.0 < effective_p_ret < 1.0 else None

    # Cohort Survival Curve S(k): % of clients observed >= k days ago who revisited on or after day k (or >= 2 visits)
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
        "expected_active_streak_days": expected_streak_days,
        "retention_half_life_days": half_life_days,
        "survival_curve": survival_curve,
    }


def _gamma_poisson_forecast(daily_counts: list[int], alpha0: float = 2.0, beta0: float = 0.05) -> dict[str, Any]:
    """Conjugate Gamma-Poisson predictive rate and 95% predictive interval."""
    n = len(daily_counts)
    total = sum(max(0, c) for c in daily_counts)
    post_a = alpha0 + total
    post_b = beta0 + max(1, n)
    lam = post_a / post_b
    # Predictive NegBin variance for 1 future day: lam + lam^2 / post_a
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


def build_statistical_analytics(conn: sqlite3.Connection, today_str: str) -> dict[str, Any]:
    """Compute all probabilistic, stochastic, and statistical metrics from SQLite."""
    # 1. Per-client daily_visits for Markov retention & Member-vs-Guest Relative Risk
    visit_rows = conn.execute("SELECT client_id, visit_date, user_id, predict_count FROM daily_visits").fetchall()
    client_dates: dict[str, set[str]] = {}
    client_is_member: dict[str, bool] = {}
    daily_dau_map: dict[str, int] = {}
    for r in visit_rows:
        cid = str(r["client_id"])
        vd = str(r["visit_date"])
        client_dates.setdefault(cid, set()).add(vd)
        if r["user_id"] is not None:
            client_is_member[cid] = True
        else:
            client_is_member.setdefault(cid, False)
        daily_dau_map[vd] = daily_dau_map.get(vd, 0) + 1

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

    # 2. User usage & Bayesian WTP segmentation
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

    for r in user_rows:
        active_days = int(r["active_days"] or 0)
        predict_calls = int(r["predict_calls"] or 0)
        total_games = int(r["draft_games"] or 0) + int(r["practice_games"] or 0)
        games_per_user.append(float(total_games))

        is_engaged = active_days >= 2 or total_games >= 1 or predict_calls >= 10
        choice = r["survey_choice"]
        if choice in {"willing", "not_willing"}:
            is_will = choice == "willing"
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

    # AI Adoption / Trust Rate vs random pick baseline (Top-5 random prob = 5/130 = 3.85%)
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
        "draft_completed_18": totals.get("draft_completed_18", 0),
        "practice_completed_18": totals.get("practice_completed_18", 0),
        "devices": {
            "mobile": totals.get("device_mobile", 0),
            "desktop": totals.get("device_desktop", 0),
        },
        "leagues": {lg: totals.get(f"league_{lg}", 0) for lg in ("GLOBAL", "RPL", "GCS", "AOG", "INTL")},
        "practice_modes": {m: totals.get(f"mode_{m}", 0) for m in ("bo1", "bo3", "bo5", "bo7")},
        "tools": {
            "timer_start": totals.get("feat_timer_start", 0),
            "pick_lane": totals.get("feat_pick_lane", 0),
            "replace_hero": totals.get("feat_replace_hero", 0),
            "practice_hints_off": totals.get("feat_practice_hints_off", 0),
        },
    }

    return {
        "markov_retention": markov_retention,
        "bayesian_wtp": bayesian_wtp,
        "member_vs_guest_retention": member_vs_guest_retention,
        "usage_distribution": usage_distribution,
        "load_forecast": load_forecast,
        "ai_trust": ai_trust,
        "latency": latency,
        "guest_vs_member_predicts": guest_vs_member_predicts,
        "feature_usage": feature_usage,
    }
