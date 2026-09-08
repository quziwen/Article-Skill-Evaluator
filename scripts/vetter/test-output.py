"""Regression tests: incomplete or inconsistent evidence must never pass."""

import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

PARSER = Path(__file__).with_name("validate-output.py")
spec = importlib.util.spec_from_file_location("scanner_output", PARSER)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ScannerEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.aguara = {"findings": [], "files_scanned": 3, "rules_loaded": 193}
        self.cisco = {"findings": [], "findings_count": 0,
                      "analyzers_used": ["static_analyzer"], "max_severity": "SAFE", "is_safe": True}

    def test_real_empty_schemas(self):
        self.assertEqual(module.counts("aguara", self.aguara), (0, 0))
        self.assertEqual(module.counts("cisco", self.cisco), (0, 0))

    def test_all_severity_levels(self):
        for severity, rank in (("INFO", 1), ("LOW", 2), ("MEDIUM", 3), ("HIGH", 4), ("CRITICAL", 5)):
            with self.subTest(severity=severity):
                self.aguara["findings"] = [{"severity": rank}]
                self.cisco.update(findings=[{"severity": severity}], findings_count=1,
                                  max_severity=severity, is_safe=rank < 4)
                expected = (int(rank >= 4), int(rank == 3))
                self.assertEqual(module.counts("aguara", self.aguara), expected)
                self.assertEqual(module.counts("cisco", self.cisco), expected)

    def test_legacy_field_requires_evidence(self):
        self.cisco["severity"] = self.cisco.pop("max_severity")
        self.cisco["analyzers_used"] = ["static"]
        self.assertEqual(module.counts("cisco", self.cisco), (0, 0))
        with self.assertRaises(ValueError):
            module.counts("cisco", {"severity": "safe"})

    def test_unknown_or_missing_severity(self):
        for scanner, original in (("aguara", self.aguara), ("cisco", self.cisco)):
            for finding in ({}, {"severity": "UNKNOWN"}, {"severity": True}, "bad"):
                with self.subTest(scanner=scanner, finding=finding):
                    broken = copy.deepcopy(original)
                    broken.update(findings=[finding], findings_count=1)
                    with self.assertRaises(ValueError):
                        module.counts(scanner, broken)

    def test_no_scan_or_failed_scan(self):
        for scanner, original, patch in (
            ("aguara", self.aguara, {"files_scanned": 0}),
            ("aguara", self.aguara, {"rules_loaded": 0}),
            ("aguara", self.aguara, {"files_scanned": True}),
            ("cisco", self.cisco, {"analyzers_used": []}),
            ("cisco", self.cisco, {"analyzers_used": ["llm"]}),
            ("cisco", self.cisco, {"analyzers_failed": {"static": "failed"}}),
            ("cisco", self.cisco, {"findings_count": 1}),
            ("cisco", self.cisco, {"is_safe": False}),
            ("cisco", self.cisco, {"max_severity": "HIGH"}),
            ("cisco", self.cisco, {"errors": ["unreadable file"]}),
        ):
            with self.subTest(scanner=scanner, patch=patch):
                broken = copy.deepcopy(original)
                broken.update(patch)
                with self.assertRaises(ValueError):
                    module.counts(scanner, broken)

    def test_missing_findings_and_malformed_json(self):
        for scanner in ("aguara", "cisco"):
            for raw in ("{", "null", "[]", "{}", json.dumps({"findings": None})):
                with self.subTest(scanner=scanner, raw=raw):
                    result = subprocess.run([sys.executable, str(PARSER), scanner],
                                            input=raw, text=True, capture_output=True)
                    self.assertEqual(result.returncode, 2)
                    self.assertEqual(result.stdout.strip(), "INVALID")


if __name__ == "__main__":
    unittest.main(verbosity=2)
