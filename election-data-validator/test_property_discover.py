"""Property-based tests for validate_folder and discover_files.

Feature: configurable-data-folder, Property 1: File discovery correctly identifies matching files
Feature: configurable-data-folder, Property 2: Case-insensitive prefix matching
Feature: configurable-data-folder, Property 3: Missing file type produces a descriptive error
Feature: configurable-data-folder, Property 4: Ambiguous file type produces a descriptive error
Feature: configurable-data-folder, Property 5: Non-existent path produces a descriptive error
"""

import importlib
import os
import shutil
import sys
import tempfile
import types

# Bootstrap: make the election-data-validator directory importable as a package.
# The directory name contains hyphens so it cannot be imported normally.
_pkg_dir = os.path.dirname(os.path.abspath(__file__))
if _pkg_dir not in sys.path:
    sys.path.insert(0, _pkg_dir)

_pkg_name = "election_data_validator"
if _pkg_name not in sys.modules:
    _pkg = types.ModuleType(_pkg_name)
    _pkg.__path__ = [_pkg_dir]
    _pkg.__file__ = os.path.join(_pkg_dir, "__init__.py")
    sys.modules[_pkg_name] = _pkg

import election_data_validator.validator  # noqa: F401
import election_data_validator.loader as _loader_mod  # noqa: E402

validate_folder = _loader_mod.validate_folder
discover_files = _loader_mod.discover_files
FILE_TYPE_PREFIXES = _loader_mod.FILE_TYPE_PREFIXES

from hypothesis import given, settings, HealthCheck
from hypothesis import strategies as st


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

suffix_st = st.from_regex(r"[A-Za-z0-9._]{1,20}", fullmatch=True)


@st.composite
def non_matching_filename_st(draw):
    """Generate a .txt filename that does NOT match any valid prefix."""
    bad_prefix = draw(st.sampled_from(["readme", "notes", "data", "info", "temp", "output"]))
    suffix = draw(suffix_st)
    return f"{bad_prefix}_{suffix}.txt"


@st.composite
def random_case_prefix(draw, prefix):
    """Return the prefix with each character randomly upper- or lower-cased."""
    chars = []
    for ch in prefix:
        if draw(st.booleans()):
            chars.append(ch.upper())
        else:
            chars.append(ch.lower())
    return "".join(chars)


# ---------------------------------------------------------------------------
# Property 1: File discovery correctly identifies matching files
# **Validates: Requirements 1.1, 5.1, 5.3**
# ---------------------------------------------------------------------------

@given(
    suffixes=st.lists(suffix_st, min_size=7, max_size=7),
    extra_files=st.lists(non_matching_filename_st(), min_size=0, max_size=5),
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_file_discovery_identifies_matching_files(suffixes, extra_files):
    """Feature: configurable-data-folder, Property 1: File discovery correctly identifies matching files

    **Validates: Requirements 1.1, 5.1, 5.3**
    """
    tmp_dir = tempfile.mkdtemp()
    try:
        expected = {}
        for prefix, suffix in zip(FILE_TYPE_PREFIXES, suffixes):
            filename = f"{prefix}_{suffix}.txt"
            with open(os.path.join(tmp_dir, filename), "w") as f:
                f.write("")
            expected[prefix] = filename

        for extra in extra_files:
            with open(os.path.join(tmp_dir, extra), "w") as f:
                f.write("")

        result = discover_files(tmp_dir)
        assert result == expected
    finally:
        shutil.rmtree(tmp_dir)


# ---------------------------------------------------------------------------
# Property 2: Case-insensitive prefix matching
# **Validates: Requirements 5.2**
# ---------------------------------------------------------------------------

@given(data=st.data(), suffix=suffix_st)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_case_insensitive_prefix_matching(data, suffix):
    """Feature: configurable-data-folder, Property 2: Case-insensitive prefix matching

    **Validates: Requirements 5.2**
    """
    tmp_dir = tempfile.mkdtemp()
    try:
        for prefix in FILE_TYPE_PREFIXES:
            cased_prefix = data.draw(random_case_prefix(prefix), label=prefix)
            filename = f"{cased_prefix}_{suffix}.txt"
            with open(os.path.join(tmp_dir, filename), "w") as f:
                f.write("")

        result = discover_files(tmp_dir)
        assert set(result.keys()) == set(FILE_TYPE_PREFIXES)
    finally:
        shutil.rmtree(tmp_dir)


# ---------------------------------------------------------------------------
# Property 3: Missing file type produces a descriptive error
# **Validates: Requirements 1.3**
# ---------------------------------------------------------------------------

@given(
    subset_indices=st.lists(
        st.integers(min_value=0, max_value=6),
        min_size=1,
        max_size=6,
        unique=True,
    ),
    suffix=suffix_st,
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_missing_file_type_produces_error(subset_indices, suffix):
    """Feature: configurable-data-folder, Property 3: Missing file type produces a descriptive error

    **Validates: Requirements 1.3**
    """
    tmp_dir = tempfile.mkdtemp()
    try:
        present_prefixes = [FILE_TYPE_PREFIXES[i] for i in sorted(subset_indices)]
        missing_prefixes = [p for p in FILE_TYPE_PREFIXES if p not in present_prefixes]

        for prefix in present_prefixes:
            filename = f"{prefix}_{suffix}.txt"
            with open(os.path.join(tmp_dir, filename), "w") as f:
                f.write("")

        try:
            discover_files(tmp_dir)
            assert False, "Expected SystemExit for missing file types"
        except SystemExit as exc:
            error_msg = str(exc)
            found_missing = [p for p in missing_prefixes if p in error_msg]
            assert len(found_missing) > 0, (
                f"Error message should name a missing type from {missing_prefixes}, "
                f"got: {error_msg}"
            )
    finally:
        shutil.rmtree(tmp_dir)


# ---------------------------------------------------------------------------
# Property 4: Ambiguous file type produces a descriptive error
# **Validates: Requirements 1.4**
# ---------------------------------------------------------------------------

@given(
    dup_index=st.integers(min_value=0, max_value=6),
    suffix1=suffix_st,
    suffix2=suffix_st,
    base_suffix=suffix_st,
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_ambiguous_file_type_produces_error(dup_index, suffix1, suffix2, base_suffix):
    """Feature: configurable-data-folder, Property 4: Ambiguous file type produces a descriptive error

    **Validates: Requirements 1.4**
    """
    # Ensure the two suffixes for the duplicate type are different
    if suffix1 == suffix2:
        suffix2 = suffix2 + "x"

    dup_prefix = FILE_TYPE_PREFIXES[dup_index]

    tmp_dir = tempfile.mkdtemp()
    try:
        # Create one file per type with base_suffix
        for prefix in FILE_TYPE_PREFIXES:
            filename = f"{prefix}_{base_suffix}.txt"
            with open(os.path.join(tmp_dir, filename), "w") as f:
                f.write("")

        # Create two additional files for the duplicate type
        dup_file1 = f"{dup_prefix}_{suffix1}.txt"
        dup_file2 = f"{dup_prefix}_{suffix2}.txt"
        with open(os.path.join(tmp_dir, dup_file1), "w") as f:
            f.write("")
        with open(os.path.join(tmp_dir, dup_file2), "w") as f:
            f.write("")

        try:
            discover_files(tmp_dir)
            assert False, "Expected SystemExit for ambiguous file type"
        except SystemExit as exc:
            error_msg = str(exc)
            assert dup_prefix in error_msg, (
                f"Error should mention '{dup_prefix}', got: {error_msg}"
            )
    finally:
        shutil.rmtree(tmp_dir)


# ---------------------------------------------------------------------------
# Property 5: Non-existent path produces a descriptive error
# **Validates: Requirements 3.1**
# ---------------------------------------------------------------------------

@given(
    path_segment=st.from_regex(r"[A-Za-z0-9_]{1,30}", fullmatch=True),
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.too_slow], deadline=None)
def test_nonexistent_path_produces_error(path_segment):
    """Feature: configurable-data-folder, Property 5: Non-existent path produces a descriptive error

    **Validates: Requirements 3.1**
    """
    tmp_dir = tempfile.mkdtemp()
    try:
        fake_path = os.path.join(tmp_dir, path_segment, "nonexistent_subdir")
        assert not os.path.exists(fake_path)

        try:
            validate_folder(fake_path)
            assert False, "Expected SystemExit for non-existent path"
        except SystemExit as exc:
            error_msg = str(exc)
            assert fake_path in error_msg, (
                f"Error should contain the path '{fake_path}', got: {error_msg}"
            )
    finally:
        shutil.rmtree(tmp_dir)
