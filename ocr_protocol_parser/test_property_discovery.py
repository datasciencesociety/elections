"""Property test for section discovery.

Feature: ocr-protocol-parser, Property 1: Section discovery returns correctly
filtered and sorted files.

**Validates: Requirements 1.1, 1.2**
"""

from __future__ import annotations

import os
import tempfile

from hypothesis import given, settings
from hypothesis import strategies as st

from cli import _PAGE_FILE_RE, _SECTION_DIR_RE, discover_html_files, discover_sections


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

# Generate a valid 9-digit section code
section_code_st = st.from_regex(r"\d{9}", fullmatch=True)

# Generate a valid page number (1–14 covers all form types)
page_number_st = st.integers(min_value=1, max_value=14)

# Generate an invalid directory name (not matching {9-digit}.0)
invalid_dir_name_st = st.one_of(
    st.from_regex(r"[a-z]{3,8}", fullmatch=True),  # letters only
    st.from_regex(r"\d{1,8}\.0", fullmatch=True),   # too few digits
    st.from_regex(r"\d{10,}\.0", fullmatch=True),    # too many digits
    st.just("readme.txt"),
)


@settings(max_examples=100)
@given(
    valid_codes=st.lists(section_code_st, min_size=1, max_size=5, unique=True),
    invalid_names=st.lists(invalid_dir_name_st, min_size=0, max_size=3),
    pages_per_section=st.lists(
        st.lists(page_number_st, min_size=1, max_size=5, unique=True),
        min_size=1,
        max_size=5,
    ),
)
def test_discover_sections_filters_and_sorts(
    valid_codes: list[str],
    invalid_names: list[str],
    pages_per_section: list[list[int]],
) -> None:
    """Property 1: discover_sections returns only valid section dirs with HTML files."""
    with tempfile.TemporaryDirectory() as tmpdir:
        expected_dirs: list[str] = []

        # Create valid section directories with HTML files
        for i, code in enumerate(valid_codes):
            dir_name = f"{code}.0"
            dir_path = os.path.join(tmpdir, dir_name)
            os.makedirs(dir_path, exist_ok=True)

            pages = pages_per_section[i % len(pages_per_section)]
            for page_num in pages:
                fname = f"{code}.0_page_{page_num}.html"
                with open(os.path.join(dir_path, fname), "w") as f:
                    f.write("<html></html>")

            expected_dirs.append(dir_path)

        # Create invalid directories (should be excluded)
        for name in invalid_names:
            inv_path = os.path.join(tmpdir, name)
            # Skip if name collides with a valid dir
            if os.path.exists(inv_path):
                continue
            try:
                os.makedirs(inv_path, exist_ok=True)
                # Put a file in it so it's not empty
                with open(os.path.join(inv_path, "dummy.html"), "w") as f:
                    f.write("<html></html>")
            except OSError:
                pass  # invalid path chars on Windows

        result = discover_sections(tmpdir)

        # All returned directories must match the valid pattern
        for d in result:
            dirname = os.path.basename(d)
            assert _SECTION_DIR_RE.match(dirname), (
                f"Returned dir {dirname} doesn't match section pattern"
            )

        # All valid directories should be in the result
        expected_set = set(os.path.normpath(d) for d in expected_dirs)
        result_set = set(os.path.normpath(d) for d in result)
        assert result_set == expected_set, (
            f"Expected {expected_set}, got {result_set}"
        )


@settings(max_examples=100)
@given(
    code=section_code_st,
    page_nums=st.lists(page_number_st, min_size=1, max_size=10, unique=True),
)
def test_discover_html_files_sorted_by_page(
    code: str,
    page_nums: list[int],
) -> None:
    """Property 1: HTML files within a section are sorted by page number."""
    with tempfile.TemporaryDirectory() as tmpdir:
        section_dir = os.path.join(tmpdir, f"{code}.0")
        os.makedirs(section_dir)

        for page_num in page_nums:
            fname = f"{code}.0_page_{page_num}.html"
            with open(os.path.join(section_dir, fname), "w") as f:
                f.write("<html></html>")

        # Also add some non-matching files
        with open(os.path.join(section_dir, "notes.txt"), "w") as f:
            f.write("not html")

        result = discover_html_files(section_dir)

        # Should have exactly the valid HTML files
        assert len(result) == len(page_nums)

        # Files should be sorted by page number
        extracted_nums = []
        for path in result:
            m = _PAGE_FILE_RE.match(os.path.basename(path))
            assert m is not None
            extracted_nums.append(int(m.group(2)))

        assert extracted_nums == sorted(page_nums), (
            f"Files not sorted by page number: {extracted_nums}"
        )
