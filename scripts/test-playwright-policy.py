from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("read-article-playwright.py")
SPEC = importlib.util.spec_from_file_location("article_reader_playwright", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class UrlPolicyTests(unittest.TestCase):
    def test_shared_public_address_cases(self) -> None:
        cases = json.loads(SCRIPT.with_name("fixtures").joinpath("url-policy-cases.json").read_text(encoding="utf-8"))
        for case in cases:
            address = case["address"]
            host = f"[{address}]" if ":" in address else address
            url = f"https://{host}/article"
            with self.subTest(address=address):
                self.assertEqual(not case["allowed"], MODULE._is_forbidden_ip(address))
                if case["allowed"]:
                    self.assertEqual(url, MODULE.validate_public_url(url, resolve_dns=False))
                else:
                    with self.assertRaises(MODULE.UrlPolicyError):
                        MODULE.validate_public_url(url, resolve_dns=False)

    def test_rejects_non_http_credentials_and_local_names(self) -> None:
        for value in (
            "file:///etc/passwd",
            "https://user:secret@example.com/a",
            "http://localhost/a",
            "http://service.local/a",
        ):
            with self.subTest(value=value), self.assertRaises(MODULE.UrlPolicyError):
                MODULE.validate_public_url(value, resolve_dns=False)

    def test_rejects_non_public_literal_addresses(self) -> None:
        for value in (
            "http://127.0.0.1/",
            "http://10.1.2.3/",
            "http://169.254.169.254/latest/meta-data/",
            "http://[::1]/",
            "http://192.0.2.1/",
        ):
            with self.subTest(value=value), self.assertRaises(MODULE.UrlPolicyError):
                MODULE.validate_public_url(value, resolve_dns=False)

    def test_allows_public_literal_without_dns(self) -> None:
        self.assertEqual(
            "https://8.8.8.8/example",
            MODULE.validate_public_url("https://8.8.8.8/example", resolve_dns=False),
        )

    def test_output_refuses_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "result.json"
            target.write_text("original", encoding="utf-8")
            with self.assertRaises(FileExistsError):
                MODULE._output_path(str(target), overwrite=False)
            self.assertEqual(target.resolve(), MODULE._output_path(str(target), overwrite=True))
            self.assertEqual("original", target.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
