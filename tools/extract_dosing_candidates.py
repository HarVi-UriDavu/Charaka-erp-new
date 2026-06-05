#!/usr/bin/env python3
"""Extract dosage-looking lines from a licensed pediatric dosing PDF.

This creates a review CSV only. A doctor/admin should verify every row before
adding it as an active dosing rule in the ERP.
"""

from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path

from pypdf import PdfReader


DOSE_PATTERNS = [
    re.compile(r"\b\d+(?:\.\d+)?\s*(?:-\s*\d+(?:\.\d+)?)?\s*(?:mg|mcg|microgram|g|unit|units|iu)\s*/\s*kg\b", re.I),
    re.compile(r"\b(?:once|twice|thrice|daily|bd|bid|tid|tds|qid|qds|q\d+h|hourly|weekly|stat)\b", re.I),
    re.compile(r"\bmaximum\b|\bmax\b|\bdose\b|\bfrequency\b", re.I),
]


def clean_line(line: str) -> str:
    return re.sub(r"\s+", " ", line).strip()


def likely_drug_heading(line: str) -> bool:
    words = line.split()
    return 1 <= len(words) <= 6 and line[:1].isupper() and not any(char.isdigit() for char in line)


def extract_candidates(pdf_path: Path) -> list[dict[str, str]]:
    reader = PdfReader(str(pdf_path))
    rows: list[dict[str, str]] = []
    current_drug = ""
    for page_no, page in enumerate(reader.pages, start=1):
      text = page.extract_text() or ""
      for raw in text.splitlines():
          line = clean_line(raw)
          if not line:
              continue
          if likely_drug_heading(line):
              current_drug = line
          if any(pattern.search(line) for pattern in DOSE_PATTERNS):
              rows.append({
                  "page": str(page_no),
                  "drug_guess": current_drug,
                  "candidate_text": line,
                  "review_status": "needs-doctor-review",
                  "notes": "",
              })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a doctor-review CSV from a licensed pediatric dosing PDF.")
    parser.add_argument("pdf", type=Path, help="Path to the licensed PDF")
    parser.add_argument("--out", type=Path, default=Path("data/dosing-candidates.csv"), help="Output CSV path")
    args = parser.parse_args()

    rows = extract_candidates(args.pdf)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["page", "drug_guess", "candidate_text", "review_status", "notes"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} candidate rows to {args.out}")
    print("Review these manually before entering active dosing rules in Admin > Masters > Dosing.")


if __name__ == "__main__":
    main()
