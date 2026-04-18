"""Region candidate count lookup.

Loads the max candidate number per region from the local_candidates file.
This determines how many candidate columns (101-N) the preference tables have.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from pathlib import Path

logger = logging.getLogger(__name__)

# Max candidate number per region (derived from local_candidates_27.10.2024.txt)
# Region number -> max candidate number (e.g., 1 -> 122 means candidates 101-122)
_DEFAULT_MAX_CANDIDATES: dict[int, int] = {
    1: 122, 2: 128, 3: 132, 4: 116, 5: 108, 6: 112, 7: 108,
    8: 110, 9: 110, 10: 108, 11: 108, 12: 108, 13: 116, 14: 108,
    15: 116, 16: 124, 17: 122, 18: 108, 19: 114, 20: 108, 21: 112,
    22: 108, 23: 138, 24: 126, 25: 128, 26: 116, 27: 122, 28: 108,
    29: 116, 30: 112, 31: 108,
}


def load_max_candidates(candidates_file: str | Path | None = None) -> dict[int, int]:
    """Load max candidate number per region.

    If a file path is provided, parses it. Otherwise returns the hardcoded defaults.
    """
    if candidates_file is None:
        return dict(_DEFAULT_MAX_CANDIDATES)

    path = Path(candidates_file)
    if not path.exists():
        logger.warning("Candidates file not found: %s, using defaults", path)
        return dict(_DEFAULT_MAX_CANDIDATES)

    max_cand: dict[int, int] = defaultdict(int)
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.strip().split(";")
        if len(parts) >= 5 and parts[0].isdigit() and parts[4].isdigit():
            region = int(parts[0])
            cand = int(parts[4])
            if cand > max_cand[region]:
                max_cand[region] = cand

    return dict(max_cand)


def get_num_candidates(section_code: str, max_candidates: dict[int, int]) -> int:
    """Get the number of candidates for a section based on its region.

    The region is the first 2 digits of the section code.
    Returns the count (e.g., 22 for max candidate 122).
    """
    region = int(section_code[:2]) if len(section_code) >= 2 else 0
    max_cand = max_candidates.get(region, 122)
    return max_cand - 100  # 122 -> 22 candidates, 110 -> 10 candidates
