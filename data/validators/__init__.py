"""
Protocol validation dispatch.

Each election slug maps to a validator module based on its CIK data format.
See individual validator files for format documentation and rule details.
"""

from . import pi2021_apr, stride2, mi2023, split4

# slug -> validate function
# Grouped by CIK data format, not by election date
VALIDATORS = {
    # Old format: form 1/7/8/14, stride-4 votes, 6-field prefs
    'pi2021_apr':               pi2021_apr.validate,

    # Stride-2 votes (total only), 5-field prefs, no real paper/machine split
    'pi2021_jul':               stride2.validate,
    'pvrns2021_ns':             stride2.validate,
    'pvrns2021_pvr_r1':         stride2.validate,  # no preferences (presidential)
    'pvrns2021_pvr_r2':         stride2.validate,  # no preferences (presidential)
    'ns2022':                   stride2.validate,

    # Local elections: stride-4 votes, no preferences
    'mi2023_council':           mi2023.validate,
    'mi2023_mayor_r1':          mi2023.validate,
    'mi2023_mayor_r2':          mi2023.validate,
    'mi2023_kmetstvo_r1':       mi2023.validate,
    'mi2023_kmetstvo_r2':       mi2023.validate,
    'mi2023_neighbourhood_r1':  mi2023.validate,
    'mi2023_neighbourhood_r2':  mi2023.validate,

    # Real stride-4 votes + 7-field preferences with machine gap handling
    'ns2023':                   split4.validate,
    'europe2024_ns':            split4.validate,
    'europe2024_ep':            split4.validate,
    'pe202410':                 split4.validate,
    'pe202410_ks':              split4.validate,
}


def validate_protocols(conn, election_id):
    """Run protocol validation for one election. Returns violation count."""
    slug = conn.execute(
        "SELECT slug FROM elections WHERE id = ?", (election_id,)
    ).fetchone()[0]

    validator = VALIDATORS.get(slug)
    if validator is None:
        print(f"  {slug}: no validator configured, skipping")
        return 0

    return validator(conn, election_id)
