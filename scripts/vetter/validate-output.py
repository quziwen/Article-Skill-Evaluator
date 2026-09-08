#!/usr/bin/env python3
"""Validate local scanner evidence before interpreting a security verdict."""

import json
import sys


def counts(scanner, result):
    if not isinstance(result, dict) or result.get("errors"):
        raise ValueError("missing result or scanner errors")
    findings = result.get("findings")
    if not isinstance(findings, list):
        raise ValueError("missing findings")
    if scanner == "aguara":
        for key in ("files_scanned", "rules_loaded"):
            if type(result.get(key)) is not int or result[key] <= 0:
                raise ValueError("scanner did not inspect files with rules")
        levels = []
        for finding in findings:
            level = finding.get("severity") if isinstance(finding, dict) else None
            if type(level) is not int or level not in range(1, 6):
                raise ValueError("unknown finding severity")
            levels.append(level)
    elif scanner == "cisco":
        analyzers = result.get("analyzers_used")
        if not isinstance(analyzers, list) or not any(name in analyzers for name in ("static", "static_analyzer")):
            raise ValueError("required static analyzer did not run")
        if result.get("analyzers_failed"):
            raise ValueError("an analyzer failed")
        if type(result.get("findings_count")) is not int or result["findings_count"] != len(findings):
            raise ValueError("finding count is missing or inconsistent")
        ranks = {"safe": 0, "none": 0, "clean": 0, "info": 1,
                 "low": 2, "medium": 3, "high": 4, "critical": 5}

        def rank(value):
            if not isinstance(value, str) or value.lower() not in ranks:
                raise ValueError("unknown severity")
            return ranks[value.lower()]

        levels = []
        for finding in findings:
            if not isinstance(finding, dict):
                raise ValueError("invalid finding")
            levels.append(rank(finding.get("severity")))
        # Cisco 2.x emits max_severity; accept the earlier field only with
        # the same complete analyzer and findings evidence.
        summary = result.get("max_severity", result.get("severity"))
        if rank(summary) != max(levels, default=0):
            raise ValueError("summary disagrees with findings")
        if "is_safe" in result and (type(result["is_safe"]) is not bool or
                                     result["is_safe"] != (max(levels, default=0) < 4)):
            raise ValueError("is_safe disagrees with findings")
    else:
        raise ValueError("unknown scanner")
    return sum(level >= 4 for level in levels), sum(level == 3 for level in levels)


if __name__ == "__main__":
    try:
        print(*counts(sys.argv[1], json.load(sys.stdin)))
    except (ValueError, TypeError, KeyError, IndexError):
        print("INVALID")
        sys.exit(2)
