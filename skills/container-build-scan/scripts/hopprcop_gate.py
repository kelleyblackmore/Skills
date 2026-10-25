#!/usr/bin/env python3
"""Fail a pipeline on vulnerabilities in a hoppr-cop enhanced CycloneDX SBOM.

hoppr-cop reports vulnerabilities but exits 0 even when it finds critical ones,
so it can't gate a build on its own. Run this on the SBOM it writes:

    hopprcop_gate.py app-enhanced.json                       # fail on high and critical
    hopprcop_gate.py app-enhanced.json --fail-on medium
    hopprcop_gate.py app-enhanced.json --assessment-max-age 90

A vulnerability is accepted only when hoppr-cop recorded an analysis for it from
analysis.assessment.yml with state not_affected, false_positive, resolved, or
resolved_with_pedigree. Accepted findings with no date, or older than
--assessment-max-age days, fail again so they get re-reviewed. Standard library only.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

SEVERITIES = ["none", "info", "low", "medium", "high", "critical"]
ACCEPTED_STATES = {"not_affected", "false_positive", "resolved", "resolved_with_pedigree"}


def severity_rank(name: str | None) -> int:
    name = (name or "").lower()
    return SEVERITIES.index(name) if name in SEVERITIES else 0


def highest_severity(vuln: dict) -> str:
    ratings = vuln.get("ratings") or []
    best = max((r.get("severity") for r in ratings), key=severity_rank, default=None)
    return (best or "unknown").lower()


def assessment_age_days(analysis: dict) -> int | None:
    issued = analysis.get("firstIssued")
    if not issued:
        return None
    when = datetime.fromisoformat(issued.replace("Z", "+00:00"))
    if when.tzinfo is None:
        when = when.replace(tzinfo=UTC)
    return (datetime.now(UTC) - when).days


def package_names(vuln: dict) -> str:
    refs = [a.get("ref", "") for a in vuln.get("affects") or []]
    return ", ".join(r.split("?")[0] for r in refs) or "?"


def evaluate(sbom: dict, fail_on: str, max_age: int) -> tuple[list[str], list[str]]:
    """Return (blocking findings, accepted findings) as printable lines."""
    threshold = severity_rank(fail_on)
    blocking, accepted = [], []
    for vuln in sbom.get("vulnerabilities") or []:
        vid = vuln.get("id", "?")
        analysis = vuln.get("analysis") or {}
        state = analysis.get("state")
        # hoppr-cop lowers the rating of assessed findings, so judge them by
        # their analysis, not their current severity.
        severity = highest_severity(vuln)
        line = f"{severity:<8} {vid:<22} {package_names(vuln)}"
        if state in ACCEPTED_STATES:
            age = assessment_age_days(analysis)
            if age is None:
                blocking.append(f"{line}  (assessment has no date; add one)")
            elif age > max_age:
                blocking.append(f"{line}  (assessment is {age} days old; re-review it)")
            else:
                accepted.append(f"{line}  ({state}: {analysis.get('justification', '-')})")
        elif severity == "unknown" or severity_rank(severity) >= threshold:
            blocking.append(line)
    return blocking, accepted


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("sbom", type=Path, help="enhanced CycloneDX SBOM written by hoppr-cop")
    parser.add_argument(
        "--fail-on",
        choices=["low", "medium", "high", "critical"],
        default="high",
        help="lowest severity that fails the gate (default: high)",
    )
    parser.add_argument(
        "--assessment-max-age",
        type=int,
        default=180,
        help="days before an accepted finding must be re-reviewed (default: 180)",
    )
    args = parser.parse_args()

    sbom = json.loads(args.sbom.read_text(encoding="utf-8"))
    blocking, accepted = evaluate(sbom, args.fail_on, args.assessment_max_age)

    total = len(sbom.get("vulnerabilities") or [])
    print(f"{total} vulnerabilities, {len(accepted)} accepted, {len(blocking)} blocking")
    print(f"(gate fails on {args.fail_on} and above)")
    for title, lines in (("Accepted", accepted), ("Blocking", blocking)):
        if lines:
            print(f"\n{title}:")
            for line in lines:
                print(f"  {line}")
    return 1 if blocking else 0


if __name__ == "__main__":
    sys.exit(main())
