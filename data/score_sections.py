"""
Compute per-section risk scores for each election and store in section_scores table.

Three independent methodologies, each producing a composite 0-1 score:

  A) Benford (benford_risk) — single signal:
    - benford_score: chi-square test of first-digit distribution vs Benford's Law
    Source: Mebane (2011), "Benford's Law and the Detection of Election Fraud"

  B) Peer Deviation (peer_risk) — spatial, single-election:
    - ekatte_turnout_zscore: turnout z-score vs same settlement (EKATTE) mean
    - peer_vote_deviation: chi-square distance of party share vs settlement mean
    Source: Klimek et al. (2012), "Statistical detection of systematic election irregularities"

  C) ACF Behavioral (acf_risk) — temporal, cross-election:
    Based on Anti-Corruption Fund (Антикорупционен фонд) methodology:
    - acf_multicomponent: section is outlier on turnout + winner result + invalid
      ballots, all compared to municipality mean (IQR-based outlier detection)
    - acf_turnout_shift: abnormal turnout change vs previous election,
      after removing municipality-level trend
    - acf_party_shift: abnormal party share change vs previous election,
      after removing municipality-level trend
    Source: ACF (2021-2023), "Контролираният и купен вот в България"

Additional binary flags (used in combined risk_score):
    - arithmetic_error: protocol mismatch (actual_voters > received_ballots)
    - vote_sum_mismatch: any party where paper + machine != total

Special sections (hospitals, prisons, mobile, abroad) are excluded from scoring
and marked with section_type. Their scores are set to 0.

Normalization uses IQR-based outlier thresholds (Q3 + 2.2*IQR to Q3 + 3*IQR)
instead of min-max, which was crushed by extreme outliers.

All signals stored individually so the UI can apply custom weights.
"""

import sqlite3
import numpy as np
from scipy.stats import chi2 as scipy_chi2
from collections import defaultdict

from pathlib import Path as _Path
DB_PATH = str(_Path(__file__).parent.parent / "elections.db")

BENFORD = np.array([np.log10(1 + 1/d) for d in range(1, 10)])

SCHEMA = """
CREATE TABLE IF NOT EXISTS section_scores (
    election_id             INTEGER NOT NULL,
    section_code            TEXT    NOT NULL,
    section_type            TEXT    DEFAULT 'normal',

    -- Signal 1: protocol arithmetic
    arithmetic_error        INTEGER DEFAULT 0,

    -- Signal 2: paper+machine vs total
    vote_sum_mismatch       INTEGER DEFAULT 0,

    -- Signal 3: turnout vs region
    turnout_rate            REAL,
    turnout_zscore          REAL,
    turnout_zscore_norm     REAL,

    -- Signal 4: Benford
    benford_chi2            REAL,
    benford_p               REAL,
    benford_score           REAL,

    -- Signal 5: turnout vs ekatte peers
    ekatte_turnout_zscore       REAL,
    ekatte_turnout_zscore_norm  REAL,

    -- Signal 6: party distribution vs ekatte peers
    peer_vote_deviation         REAL,
    peer_vote_deviation_norm    REAL,

    -- Signal 7: ACF multi-component (turnout + winner + invalid, all outliers vs municipality)
    acf_turnout_outlier         REAL DEFAULT 0,
    acf_winner_outlier          REAL DEFAULT 0,
    acf_invalid_outlier         REAL DEFAULT 0,
    acf_multicomponent          REAL DEFAULT 0,

    -- Signal 8: ACF turnout shift vs previous election
    acf_turnout_shift           REAL,
    acf_turnout_shift_norm      REAL DEFAULT 0,

    -- Signal 9: ACF party shift vs previous election
    acf_party_shift             REAL,
    acf_party_shift_norm        REAL DEFAULT 0,

    -- Composite scores per methodology
    risk_score              REAL,
    benford_risk            REAL DEFAULT 0,
    peer_risk               REAL DEFAULT 0,
    acf_risk                REAL DEFAULT 0,

    PRIMARY KEY (election_id, section_code),
    FOREIGN KEY (election_id) REFERENCES elections(id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_scores_election ON section_scores(election_id);
CREATE INDEX IF NOT EXISTS idx_scores_section  ON section_scores(section_code);
CREATE INDEX IF NOT EXISTS idx_scores_risk     ON section_scores(risk_score DESC);
"""

HISTORY_VIEW = """
DROP VIEW IF EXISTS section_risk_history;
CREATE VIEW section_risk_history AS
SELECT
    sc.section_code,
    sc.section_type,
    l.settlement_name,
    l.address,
    l.ekatte,
    COUNT(*)                                    AS elections_scored,
    ROUND(AVG(sc.risk_score), 4)                AS avg_risk_score,
    ROUND(MAX(sc.risk_score), 4)                AS max_risk_score,
    SUM(sc.arithmetic_error)                    AS total_arithmetic_errors,
    SUM(sc.vote_sum_mismatch)                   AS total_vote_mismatches,
    ROUND(AVG(sc.ekatte_turnout_zscore_norm),4) AS avg_ekatte_turnout_anomaly,
    ROUND(AVG(sc.peer_vote_deviation_norm), 4)  AS avg_peer_vote_anomaly,
    ROUND(AVG(sc.acf_risk), 4)                  AS avg_acf_risk
FROM section_scores sc
LEFT JOIN (SELECT section_code, location_id FROM sections GROUP BY section_code) s
    ON s.section_code = sc.section_code
LEFT JOIN locations l ON l.id = s.location_id
GROUP BY sc.section_code;
"""


# --- Section type classification ---

HOSPITAL_KEYWORDS = ['болниц', 'умбал', 'мбал', 'клиник', 'дкц', 'диспансер',
                     'хоспис', 'дом за стари хора', 'дом за възрастни']
MOBILE_KEYWORDS = ['подвижна', 'псик']
PRISON_KEYWORDS = ['затвор', 'арест']
ABROAD_RIK = '32'


def classify_section(rik_code, address):
    """Classify section as normal, hospital, prison, mobile, or abroad."""
    if rik_code == ABROAD_RIK:
        return 'abroad'
    addr_lower = (address or '').lower()
    for kw in MOBILE_KEYWORDS:
        if kw in addr_lower:
            return 'mobile'
    for kw in PRISON_KEYWORDS:
        if kw in addr_lower:
            return 'prison'
    for kw in HOSPITAL_KEYWORDS:
        if kw in addr_lower:
            return 'hospital'
    return 'normal'


# --- Math utilities ---

def first_digit(n):
    if n <= 0:
        return None
    return int(str(n)[0])


def benford_chi2_score(vote_totals):
    digits = [first_digit(v) for v in vote_totals if v and v > 0]
    if len(digits) < 5:
        return None, None
    observed = np.zeros(9)
    for d in digits:
        observed[d - 1] += 1
    n = observed.sum()
    expected = BENFORD * n
    mask = expected >= 1
    if mask.sum() < 2:
        return None, None
    stat = float(np.sum((observed[mask] - expected[mask]) ** 2 / expected[mask]))
    df = int(mask.sum()) - 1
    p = float(1 - scipy_chi2.cdf(stat, df))
    return stat, p


def zscores_for_group(items):
    """items: list of (key, value). Returns dict key->zscore."""
    if len(items) < 2:
        return {k: 0.0 for k, _ in items}
    vals = np.array([v for _, v in items])
    mean, std = vals.mean(), vals.std()
    return {k: float((v - mean) / std) if std > 0 else 0.0 for k, v in items}


def party_share_vector(vote_entries, all_parties):
    """Compute normalized party share vector over a fixed party list."""
    total = sum(t for t, _ in vote_entries)
    if total == 0:
        return np.zeros(len(all_parties))
    lookup = {p: t for t, p in vote_entries}
    vec = np.array([lookup.get(p, 0) for p in all_parties], dtype=float)
    return vec / total


def chi2_distance(obs, expected):
    """Chi-square distance between two distributions (expected as reference)."""
    mask = expected > 0
    if mask.sum() == 0:
        return 0.0
    return float(np.sum((obs[mask] - expected[mask]) ** 2 / expected[mask]))


def iqr_normalize(values, low_mult=2.2, high_mult=3.0):
    """IQR-based normalization (ACF approach).

    Values below Q3 + low_mult*IQR → 0
    Values above Q3 + high_mult*IQR → 1
    Linear interpolation between.
    Returns list of normalized values 0-1.
    """
    arr = np.array(values, dtype=float)
    if len(arr) == 0:
        return []
    q1 = np.percentile(arr, 25)
    q3 = np.percentile(arr, 75)
    iqr = q3 - q1
    if iqr == 0:
        # Fallback: use percentile-based normalization
        p95 = np.percentile(arr, 95)
        p50 = np.percentile(arr, 50)
        if p95 == p50:
            return [0.0] * len(arr)
        return list(np.clip((arr - p50) / (p95 - p50), 0, 1))
    low = q3 + low_mult * iqr
    high = q3 + high_mult * iqr
    if high == low:
        return [1.0 if v > low else 0.0 for v in arr]
    return list(np.clip((arr - low) / (high - low), 0, 1))


def iqr_is_outlier(value, q1, q3, mult=2.2):
    """Check if value is an outlier using IQR method."""
    iqr = q3 - q1
    return value > q3 + mult * iqr


# --- ACF Model 1: Multi-component unusual behavior ---

def acf_multicomponent_scores(conn, election_id, section_meta, normal_sections):
    """
    ACF Model 1: section has ALL of:
    (1) unusually high turnout vs municipality mean
    (2) unusually high winner % vs municipality mean
    (3) unusually high invalid ballot % vs municipality mean

    Uses IQR outlier detection at municipality level.
    Returns dict: section_code -> (turnout_outlier, winner_outlier, invalid_outlier, combined)
    """
    cur = conn.cursor()

    # Get per-section: turnout, winner_pct, invalid_pct, municipality_id
    cur.execute("""
        SELECT pr.section_code, l.municipality_id,
               pr.actual_voters, pr.registered_voters,
               pr.invalid_votes
        FROM protocols pr
        JOIN sections s ON s.section_code = pr.section_code AND s.election_id = pr.election_id
        JOIN locations l ON l.id = s.location_id
        WHERE pr.election_id = ?
    """, (election_id,))
    proto_rows = cur.fetchall()

    # Get winner % per section
    cur.execute("""
        SELECT v.section_code, MAX(v.total) as winner_votes, SUM(v.total) as total_votes
        FROM votes v
        WHERE v.election_id = ? AND v.total > 0
        GROUP BY v.section_code
    """, (election_id,))
    winner_data = {r[0]: (r[1] / r[2] if r[2] > 0 else 0) for r in cur.fetchall()}

    # Build per-municipality groups (normal sections only)
    by_muni = defaultdict(list)  # muni_id -> [(sc, turnout, winner_pct, invalid_pct)]

    section_data = {}
    for sc, muni_id, actual, registered, invalid in proto_rows:
        if sc not in normal_sections:
            continue
        if not registered or registered <= 0:
            continue
        turnout = actual / registered if actual else 0
        winner_pct = winner_data.get(sc, 0)
        total_ballots = actual or 0
        invalid_pct = (invalid / total_ballots) if (invalid and total_ballots > 0) else 0

        section_data[sc] = (muni_id, turnout, winner_pct, invalid_pct)
        if muni_id:
            by_muni[muni_id].append((sc, turnout, winner_pct, invalid_pct))

    results = {}
    for muni_id, sections in by_muni.items():
        if len(sections) < 4:
            for sc, _, _, _ in sections:
                results[sc] = (0.0, 0.0, 0.0, 0.0)
            continue

        turnouts = np.array([t for _, t, _, _ in sections])
        winner_pcts = np.array([w for _, _, w, _ in sections])
        invalid_pcts = np.array([i for _, _, _, i in sections])

        t_q1, t_q3 = np.percentile(turnouts, 25), np.percentile(turnouts, 75)
        w_q1, w_q3 = np.percentile(winner_pcts, 25), np.percentile(winner_pcts, 75)
        i_q1, i_q3 = np.percentile(invalid_pcts, 25), np.percentile(invalid_pcts, 75)

        for sc, turnout, winner_pct, invalid_pct in sections:
            t_out = 1.0 if iqr_is_outlier(turnout, t_q1, t_q3) else 0.0
            w_out = 1.0 if iqr_is_outlier(winner_pct, w_q1, w_q3) else 0.0
            i_out = 1.0 if iqr_is_outlier(invalid_pct, i_q1, i_q3) else 0.0
            # Combined: all three must be outliers for the full signal
            combined = 1.0 if (t_out and w_out and i_out) else (t_out + w_out + i_out) / 3.0
            results[sc] = (t_out, w_out, i_out, combined)

    return results


# --- ACF Model 2 & 3: Temporal shift models ---

def find_previous_election(conn, election_id):
    """Find the previous election of the same type."""
    cur = conn.cursor()
    cur.execute("SELECT id, date, type FROM elections WHERE id = ?", (election_id,))
    row = cur.fetchone()
    if not row:
        return None
    eid, date, etype = row

    # For parliament elections, find the most recent previous parliament election
    cur.execute("""
        SELECT id FROM elections
        WHERE type = ? AND date < ?
        ORDER BY date DESC LIMIT 1
    """, (etype, date))
    prev = cur.fetchone()
    return prev[0] if prev else None


def acf_temporal_scores(conn, election_id, prev_election_id, normal_sections):
    """
    ACF Models 2 & 3:
    - Model 2: turnout change vs previous election, after removing municipality trend
    - Model 3: party share change vs previous election, after removing municipality trend

    Returns dict: section_code -> (turnout_shift, party_shift)
    """
    if prev_election_id is None:
        return {}

    cur = conn.cursor()

    # --- Turnout for both elections ---
    def get_turnout_by_section(eid):
        cur.execute("""
            SELECT pr.section_code, l.municipality_id,
                   CASE WHEN pr.registered_voters > 0
                        THEN CAST(pr.actual_voters AS REAL) / pr.registered_voters
                        ELSE 0 END as turnout
            FROM protocols pr
            JOIN sections s ON s.section_code = pr.section_code AND s.election_id = pr.election_id
            JOIN locations l ON l.id = s.location_id
            WHERE pr.election_id = ?
        """, (eid,))
        return {r[0]: (r[1], r[2]) for r in cur.fetchall()}

    curr_turnout = get_turnout_by_section(election_id)
    prev_turnout = get_turnout_by_section(prev_election_id)

    # --- Party shares for both elections ---
    def get_party_shares(eid):
        """Returns dict: section_code -> {party_id: share}"""
        cur.execute("""
            SELECT v.section_code, ep.party_id, v.total
            FROM votes v
            JOIN election_parties ep ON ep.election_id = v.election_id AND ep.ballot_number = v.party_number
            WHERE v.election_id = ?
        """, (eid,))
        by_section = defaultdict(dict)
        totals = defaultdict(int)
        for sc, pid, total in cur.fetchall():
            by_section[sc][pid] = by_section[sc].get(pid, 0) + total
            totals[sc] += total
        # Normalize to shares
        result = {}
        for sc, parties in by_section.items():
            t = totals[sc]
            if t > 0:
                result[sc] = {pid: votes / t for pid, votes in parties.items()}
            else:
                result[sc] = {}
        return result

    curr_shares = get_party_shares(election_id)
    prev_shares = get_party_shares(prev_election_id)

    # Common sections
    common = set(curr_turnout.keys()) & set(prev_turnout.keys()) & normal_sections

    # Municipality-level mean turnout change
    muni_turnout_change = defaultdict(list)
    for sc in common:
        muni_id = curr_turnout[sc][0]
        if muni_id is None:
            continue
        delta = curr_turnout[sc][1] - prev_turnout[sc][1]
        muni_turnout_change[muni_id].append(delta)

    muni_mean_turnout_change = {
        m: np.mean(deltas) for m, deltas in muni_turnout_change.items()
    }

    # Municipality-level mean party share change (per major party)
    # Find parties present in both elections
    all_parties_curr = set()
    all_parties_prev = set()
    for shares in curr_shares.values():
        all_parties_curr.update(shares.keys())
    for shares in prev_shares.values():
        all_parties_prev.update(shares.keys())
    common_parties = all_parties_curr & all_parties_prev

    # Compute municipality-level mean share change per party
    muni_share_changes = defaultdict(lambda: defaultdict(list))
    for sc in common:
        muni_id = curr_turnout[sc][0]
        if muni_id is None:
            continue
        cs = curr_shares.get(sc, {})
        ps = prev_shares.get(sc, {})
        for pid in common_parties:
            delta = cs.get(pid, 0) - ps.get(pid, 0)
            muni_share_changes[muni_id][pid].append(delta)

    muni_mean_share_change = {}
    for muni_id, party_deltas in muni_share_changes.items():
        muni_mean_share_change[muni_id] = {
            pid: np.mean(deltas) for pid, deltas in party_deltas.items()
        }

    # Per section: compute adjusted shifts
    results = {}
    for sc in common:
        muni_id = curr_turnout[sc][0]
        if muni_id is None:
            results[sc] = (0.0, 0.0)
            continue

        # Model 2: turnout shift adjusted for municipality trend
        raw_turnout_delta = curr_turnout[sc][1] - prev_turnout[sc][1]
        muni_trend = muni_mean_turnout_change.get(muni_id, 0)
        adjusted_turnout_shift = abs(raw_turnout_delta - muni_trend)

        # Model 3: party shift — max absolute adjusted change across major parties
        cs = curr_shares.get(sc, {})
        ps = prev_shares.get(sc, {})
        muni_share = muni_mean_share_change.get(muni_id, {})

        max_party_shift = 0.0
        for pid in common_parties:
            raw_delta = cs.get(pid, 0) - ps.get(pid, 0)
            muni_party_trend = muni_share.get(pid, 0)
            adjusted = abs(raw_delta - muni_party_trend)
            max_party_shift = max(max_party_shift, adjusted)

        results[sc] = (adjusted_turnout_shift, max_party_shift)

    return results


# --- Main scoring ---

def score_election(conn, election_id, prev_election_id=None):
    cur = conn.cursor()

    # --- Section classification ---
    cur.execute("""
        SELECT s.section_code, s.rik_code, l.address, l.ekatte, l.municipality_id
        FROM sections s
        JOIN locations l ON l.id = s.location_id
        WHERE s.election_id = ?
    """, (election_id,))
    section_info = {}
    for sc, rik, addr, ekatte, muni_id in cur.fetchall():
        stype = classify_section(rik, addr)
        section_info[sc] = {
            'type': stype, 'rik': rik, 'address': addr,
            'ekatte': ekatte, 'municipality_id': muni_id
        }

    normal_sections = {sc for sc, info in section_info.items() if info['type'] == 'normal'}
    special_count = len(section_info) - len(normal_sections)
    print(f"    {len(normal_sections)} normal + {special_count} special sections")

    # --- protocols + section metadata ---
    cur.execute("""
        SELECT pr.section_code,
               pr.received_ballots, pr.registered_voters, pr.actual_voters,
               s.rik_code, l.ekatte
        FROM protocols pr
        JOIN sections s ON s.section_code = pr.section_code AND s.election_id = pr.election_id
        LEFT JOIN locations l ON l.id = s.location_id
        WHERE pr.election_id = ?
    """, (election_id,))
    proto_rows = cur.fetchall()

    protocols = {}
    by_rik = defaultdict(list)
    by_ekatte = defaultdict(list)

    for sc, received, registered, actual, rik, ekatte in proto_rows:
        if sc not in normal_sections:
            continue
        turnout = (actual / registered) if (registered and registered > 0 and actual is not None) else 0.0
        arith_err = 1 if (received is not None and actual is not None and received > 0 and actual > received) else 0
        protocols[sc] = {"arithmetic_error": arith_err, "turnout": turnout, "rik": rik, "ekatte": ekatte}
        by_rik[rik].append((sc, turnout))
        if ekatte:
            by_ekatte[ekatte].append((sc, turnout))

    # z-scores: rik-level and ekatte-level
    rik_z = {}
    for group in by_rik.values():
        rik_z.update(zscores_for_group(group))

    ekatte_z = {}
    for group in by_ekatte.values():
        ekatte_z.update(zscores_for_group(group))

    # --- votes ---
    cur.execute("""
        SELECT section_code, party_number, total, paper, machine
        FROM votes WHERE election_id = ? AND total > 0
    """, (election_id,))
    vote_rows = cur.fetchall()

    votes_by_section = defaultdict(list)
    party_totals_by_section = defaultdict(list)

    for sc, party, total, paper, machine in vote_rows:
        if sc not in normal_sections:
            continue
        votes_by_section[sc].append((total, paper or 0, machine or 0))
        party_totals_by_section[sc].append((total, party))

    section_vote_mismatch = {
        sc: 1 if any(abs((p + m) - t) > 0 for t, p, m in entries) else 0
        for sc, entries in votes_by_section.items()
    }

    section_benford = {
        sc: benford_chi2_score([t for t, _, _ in entries])
        for sc, entries in votes_by_section.items()
    }

    # --- peer vote deviation ---
    cur.execute("""
        SELECT s.section_code, l.ekatte
        FROM sections s
        JOIN locations l ON l.id = s.location_id
        WHERE s.election_id = ?
    """, (election_id,))
    section_ekatte = {r[0]: r[1] for r in cur.fetchall() if r[0] in normal_sections}

    ekatte_sections = defaultdict(list)
    for sc, ekatte in section_ekatte.items():
        if ekatte:
            ekatte_sections[ekatte].append(sc)

    all_parties_global = sorted({p for entries in party_totals_by_section.values() for _, p in entries})

    ekatte_mean_share = {}
    for ekatte, scs in ekatte_sections.items():
        shares = []
        for sc in scs:
            entries = party_totals_by_section.get(sc, [])
            if entries:
                shares.append(party_share_vector(entries, all_parties_global))
        if shares:
            ekatte_mean_share[ekatte] = np.mean(shares, axis=0)

    peer_deviation = {}
    for sc in section_ekatte:
        ekatte = section_ekatte[sc]
        if not ekatte or ekatte not in ekatte_mean_share:
            peer_deviation[sc] = 0.0
            continue
        entries = party_totals_by_section.get(sc, [])
        if not entries:
            peer_deviation[sc] = 0.0
            continue
        share = party_share_vector(entries, all_parties_global)
        mean_share = ekatte_mean_share[ekatte]
        n_peers = len(ekatte_sections[ekatte])
        dev = chi2_distance(share, mean_share) if n_peers > 1 else 0.0
        peer_deviation[sc] = dev

    # --- ACF models ---
    acf_multi = acf_multicomponent_scores(conn, election_id, section_info, normal_sections)
    acf_temporal = acf_temporal_scores(conn, election_id, prev_election_id, normal_sections)

    # --- Collect all normal sections ---
    all_sections = sorted(normal_sections)

    # Collect raw signal values for IQR normalization
    benford_raw = []
    for sc in all_sections:
        _, p_val = section_benford.get(sc, (None, None))
        benford_raw.append(-np.log(p_val + 1e-10) if p_val is not None else 0.0)

    tz_raw = [abs(rik_z.get(sc, 0.0)) for sc in all_sections]
    ekatte_z_raw = [abs(ekatte_z.get(sc, 0.0)) for sc in all_sections]
    peer_dev_raw = [peer_deviation.get(sc, 0.0) for sc in all_sections]
    acf_turnout_shift_raw = [acf_temporal.get(sc, (0.0, 0.0))[0] for sc in all_sections]
    acf_party_shift_raw = [acf_temporal.get(sc, (0.0, 0.0))[1] for sc in all_sections]

    # IQR-based normalization (replaces min-max)
    benford_norm = iqr_normalize(benford_raw)
    tz_norm = iqr_normalize(tz_raw)
    ekatte_z_norm = iqr_normalize(ekatte_z_raw)
    peer_dev_norm = iqr_normalize(peer_dev_raw)
    acf_ts_norm = iqr_normalize(acf_turnout_shift_raw)
    acf_ps_norm = iqr_normalize(acf_party_shift_raw)

    # --- Build rows for normal sections ---
    rows = []
    for i, sc in enumerate(all_sections):
        p_data = protocols.get(sc, {})
        arith_err = p_data.get("arithmetic_error", 0)
        turnout = p_data.get("turnout", 0.0)
        chi2_stat, p_val = section_benford.get(sc, (None, None))

        s1 = arith_err                           # 0 or 1
        s2 = section_vote_mismatch.get(sc, 0)    # 0 or 1
        s3 = tz_norm[i]
        s4 = benford_norm[i]
        s5 = ekatte_z_norm[i]
        s6 = peer_dev_norm[i]

        # ACF signals
        acf_m = acf_multi.get(sc, (0.0, 0.0, 0.0, 0.0))
        acf_t = acf_temporal.get(sc, (0.0, 0.0))

        s7_turnout_out = acf_m[0]
        s7_winner_out = acf_m[1]
        s7_invalid_out = acf_m[2]
        s7_combined = acf_m[3]
        s8_turnout_shift = acf_t[0] if acf_t else None
        s8_norm = acf_ts_norm[i]
        s9_party_shift = acf_t[1] if acf_t else None
        s9_norm = acf_ps_norm[i]

        # Composite: combined risk (all signals)
        risk = round((s1 + s2 + s3 + s4 + s5 + s6) / 6, 4)

        # Per-methodology composites
        benford_risk_val = round(s4, 4)  # Benford is a single signal
        peer_risk_val = round((s5 + s6) / 2, 4)  # EKATTE turnout + party deviation
        # ACF: only average signals that exist (temporal models need a previous election)
        if prev_election_id and sc in acf_temporal:
            acf_risk_val = round((s7_combined + s8_norm + s9_norm) / 3, 4)
        else:
            acf_risk_val = round(s7_combined, 4)  # only multicomponent available

        rows.append((
            election_id, sc, 'normal',
            arith_err,
            section_vote_mismatch.get(sc, 0),
            round(turnout, 4),
            round(rik_z.get(sc, 0.0), 4),
            round(tz_norm[i], 4),
            chi2_stat,
            p_val,
            round(benford_norm[i], 4),
            round(ekatte_z.get(sc, 0.0), 4),
            round(ekatte_z_norm[i], 4),
            round(peer_deviation.get(sc, 0.0), 4),
            round(peer_dev_norm[i], 4),
            # ACF fields
            round(s7_turnout_out, 4),
            round(s7_winner_out, 4),
            round(s7_invalid_out, 4),
            round(s7_combined, 4),
            round(s8_turnout_shift, 4) if s8_turnout_shift is not None else None,
            round(s8_norm, 4),
            round(s9_party_shift, 4) if s9_party_shift is not None else None,
            round(s9_norm, 4),
            # Composites
            risk,
            benford_risk_val,
            peer_risk_val,
            acf_risk_val,
        ))

    # --- Build rows for special sections (zeroed scores) ---
    special_sections = sorted(set(section_info.keys()) - normal_sections)
    for sc in special_sections:
        info = section_info[sc]
        p_data = protocols.get(sc, {})
        turnout = p_data.get("turnout", 0.0)

        rows.append((
            election_id, sc, info['type'],
            0, 0,  # no errors flagged
            round(turnout, 4), 0.0, 0.0,  # turnout but no z-score
            None, None, 0.0,  # no benford
            0.0, 0.0, 0.0, 0.0,  # no ekatte/peer
            0.0, 0.0, 0.0, 0.0,  # no ACF multi
            None, 0.0, None, 0.0,  # no ACF temporal
            0.0, 0.0, 0.0, 0.0,  # all composites zero
        ))

    cur.executemany("""
        INSERT OR REPLACE INTO section_scores (
            election_id, section_code, section_type,
            arithmetic_error, vote_sum_mismatch,
            turnout_rate, turnout_zscore, turnout_zscore_norm,
            benford_chi2, benford_p, benford_score,
            ekatte_turnout_zscore, ekatte_turnout_zscore_norm,
            peer_vote_deviation, peer_vote_deviation_norm,
            acf_turnout_outlier, acf_winner_outlier, acf_invalid_outlier, acf_multicomponent,
            acf_turnout_shift, acf_turnout_shift_norm,
            acf_party_shift, acf_party_shift_norm,
            risk_score, benford_risk, peer_risk, acf_risk
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, rows)
    conn.commit()
    return len(rows)


def main():
    conn = sqlite3.connect(DB_PATH)

    print("Recreating schema...")
    conn.execute("DROP TABLE IF EXISTS section_scores")
    conn.executescript(SCHEMA)

    cur = conn.cursor()
    cur.execute("SELECT id, slug, date, type FROM elections ORDER BY date")
    elections = cur.fetchall()

    # Build election chain for temporal models
    election_chain = {}  # election_id -> previous_election_id
    by_type = defaultdict(list)
    for eid, slug, date, etype in elections:
        by_type[etype].append((date, eid))
    for etype, elecs in by_type.items():
        elecs.sort()
        for i, (date, eid) in enumerate(elecs):
            if i > 0:
                election_chain[eid] = elecs[i-1][1]

    for eid, slug, date, etype in elections:
        prev_eid = election_chain.get(eid)
        prev_slug = None
        if prev_eid:
            prev_slug = next((s for e, s, _, _ in elections if e == prev_eid), None)
        print(f"  {slug} ({date}){f' [prev: {prev_slug}]' if prev_slug else ' [no previous]'}:")
        n = score_election(conn, eid, prev_eid)
        print(f"    {n} sections scored")

    print("Creating history view...")
    conn.executescript(HISTORY_VIEW)

    # Create indexes
    conn.execute("CREATE INDEX IF NOT EXISTS idx_section_scores_election ON section_scores(election_id);")
    conn.commit()

    conn.close()
    print("Done.")


if __name__ == "__main__":
    main()
