"""
compare_results.py

Compare a predicted election protocol JSON against a ground-truth JSON.

Usage:
    python compare_results.py <gt.json> <result.json>

Example:
    python compare_results.py data/gt/122400005.0_gt.json elections/result_122400005.0.json
"""

import json
import sys
from pathlib import Path


def load(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        # GT files may have trailing commas — strip them with a lenient fallback
        try:
            return json.load(f)
        except json.JSONDecodeError:
            import re
            text = Path(path).read_text(encoding="utf-8")
            text = re.sub(r",\s*([}\]])", r"\1", text)  # remove trailing commas
            return json.loads(text)


def fmt(v):
    return str(v) if v is not None else "null"


def compare_scalar(label: str, gt_val, pred_val, errors: list, nulls: list):
    if gt_val is None and pred_val is None:
        return
    if pred_val is None:
        nulls.append(f"  {label}: GT={fmt(gt_val)}, PRED=null")
        return
    if gt_val != pred_val:
        errors.append(f"  {label}: GT={fmt(gt_val)}, PRED={fmt(pred_val)}  (diff={fmt(pred_val - gt_val) if isinstance(gt_val, (int, float)) and isinstance(pred_val, (int, float)) else '?'})")


def compare_votes(section: str, gt_votes: list, pred_votes: list, errors: list, nulls: list):
    pred_by_party = {v["party_number"]: v for v in pred_votes}
    gt_by_party   = {v["party_number"]: v for v in gt_votes}

    all_parties = sorted(set(gt_by_party) | set(pred_by_party))

    for pn in all_parties:
        prefix = f"{section}.votes[party={pn}]"
        if pn not in gt_by_party:
            errors.append(f"  {prefix}: extra party in PRED (not in GT)")
            continue
        if pn not in pred_by_party:
            errors.append(f"  {prefix}: missing party in PRED")
            continue

        gt_v   = gt_by_party[pn]
        pred_v = pred_by_party[pn]

        compare_scalar(f"{prefix}.votes",          gt_v.get("votes"),          pred_v.get("votes"),          errors, nulls)
        compare_scalar(f"{prefix}.no_preferences", gt_v.get("no_preferences"), pred_v.get("no_preferences"), errors, nulls)

        # Compare preferences
        gt_prefs   = {p["candidate_number"]: p["count"] for p in gt_v.get("preferences", [])}
        pred_prefs = {p["candidate_number"]: p["count"] for p in pred_v.get("preferences", [])}
        all_cands  = sorted(set(gt_prefs) | set(pred_prefs))
        for cn in all_cands:
            label = f"{prefix}.preferences[cand={cn}].count"
            if cn not in gt_prefs:
                errors.append(f"  {label}: extra candidate in PRED (not in GT)")
            elif cn not in pred_prefs:
                nulls.append(f"  {label}: missing in PRED, GT={gt_prefs[cn]}")
            elif gt_prefs[cn] != pred_prefs[cn]:
                errors.append(f"  {label}: GT={gt_prefs[cn]}, PRED={pred_prefs[cn]}")


def compare(gt: dict, pred: dict):
    errors = []  # wrong values
    nulls  = []  # fields missing in pred but present in GT

    # Top-level scalars
    for key in ["sik_no", "voter_count", "additional_voter_count", "registered_votes"]:
        compare_scalar(key, gt.get(key), pred.get(key), errors, nulls)

    # Paper ballots scalars
    gt_pb   = gt.get("paper_ballots", {})
    pred_pb = pred.get("paper_ballots", {})
    for key in ["total", "unused_ballots", "registered_vote",
                "invalid_out_of_the_box", "invalid_in_the_box",
                "support_noone", "total_valid_votes"]:
        compare_scalar(f"paper_ballots.{key}", gt_pb.get(key), pred_pb.get(key), errors, nulls)

    compare_votes("paper_ballots", gt_pb.get("votes", []), pred_pb.get("votes", []), errors, nulls)

    # Machine ballots scalars
    gt_mb   = gt.get("machine_ballots", {})
    pred_mb = pred.get("machine_ballots", {})
    for key in ["total_votes", "support_noone", "total_valid_votes"]:
        compare_scalar(f"machine_ballots.{key}", gt_mb.get(key), pred_mb.get(key), errors, nulls)

    compare_votes("machine_ballots", gt_mb.get("votes", []), pred_mb.get("votes", []), errors, nulls)

    return errors, nulls


def score(gt: dict, pred: dict, errors: list, nulls: list) -> dict:
    """Count total comparable scalar fields and how many match."""
    total = wrong = missing = 0

    def count_scalars(gt_d, pred_d, keys):
        nonlocal total, wrong, missing
        for k in keys:
            gv = gt_d.get(k)
            pv = pred_d.get(k)
            if gv is None:
                continue
            total += 1
            if pv is None:
                missing += 1
            elif gv != pv:
                wrong += 1

    count_scalars(gt, pred, ["sik_no", "voter_count", "additional_voter_count", "registered_votes"])
    count_scalars(gt.get("paper_ballots", {}), pred.get("paper_ballots", {}),
                  ["total", "unused_ballots", "registered_vote", "invalid_out_of_the_box",
                   "invalid_in_the_box", "support_noone", "total_valid_votes"])
    count_scalars(gt.get("machine_ballots", {}), pred.get("machine_ballots", {}),
                  ["total_votes", "support_noone", "total_valid_votes"])

    def count_votes(gt_votes, pred_votes):
        nonlocal total, wrong, missing
        pred_by_party = {v["party_number"]: v for v in pred_votes}
        for gv in gt_votes:
            pn = gv["party_number"]
            pv = pred_by_party.get(pn, {})
            for k in ["votes", "no_preferences"]:
                gval = gv.get(k)
                if gval is None:
                    continue
                total += 1
                pval = pv.get(k)
                if pval is None:
                    missing += 1
                elif gval != pval:
                    wrong += 1
            # preferences counts
            gt_prefs   = {p["candidate_number"]: p["count"] for p in gv.get("preferences", [])}
            pred_prefs = {p["candidate_number"]: p["count"] for p in pv.get("preferences", [])}
            for cn, gcount in gt_prefs.items():
                total += 1
                if cn not in pred_prefs:
                    missing += 1
                elif pred_prefs[cn] != gcount:
                    wrong += 1

    count_votes(gt.get("paper_ballots", {}).get("votes", []),
                pred.get("paper_ballots", {}).get("votes", []))
    count_votes(gt.get("machine_ballots", {}).get("votes", []),
                pred.get("machine_ballots", {}).get("votes", []))

    correct = total - wrong - missing
    return {"total": total, "correct": correct, "wrong": wrong, "missing": missing,
            "accuracy": round(100 * correct / total, 1) if total else 0}


def main():
    if len(sys.argv) != 3:
        print("Usage: python compare_results.py <gt.json> <result.json>")
        sys.exit(1)

    gt_path, pred_path = sys.argv[1], sys.argv[2]
    gt   = load(gt_path)
    pred = load(pred_path)

    errors, nulls = compare(gt, pred)
    stats = score(gt, pred, errors, nulls)

    print(f"\n{'='*60}")
    print(f"  GT:    {gt_path}")
    print(f"  PRED:  {pred_path}")
    print(f"{'='*60}")
    print(f"  Total fields:  {stats['total']}")
    print(f"  ✅ Correct:    {stats['correct']}  ({stats['accuracy']}%)")
    print(f"  ❌ Wrong:      {stats['wrong']}")
    print(f"  ◻️  Missing:    {stats['missing']}")
    print(f"{'='*60}")

    if errors:
        print(f"\n❌ WRONG VALUES ({len(errors)}):")
        for e in errors:
            print(e)

    if nulls:
        print(f"\n◻️  MISSING IN PRED ({len(nulls)}):")
        for n in nulls:
            print(n)

    if not errors and not nulls:
        print("\n🎉 Perfect match!")

    print()


if __name__ == "__main__":
    main()
