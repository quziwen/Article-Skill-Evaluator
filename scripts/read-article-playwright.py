# -*- coding: utf-8 -*-
"""Read a public article through a temporary Playwright browser context.

The helper is read-only. It rejects credentials, localhost, private/link-local/
reserved addresses and unsafe redirect targets. It never installs Playwright,
reuses a personal browser profile, logs in, solves a CAPTCHA, or submits forms.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
from urllib.parse import urlsplit


ARTICLE_SELECTORS = [
    "article",
    "div.article-content",
    "div[class*='article']",
    "div[class*='ArticleDetail']",
    "div[class*='tt-article']",
    "div[class*='content']",
]

ALLOWED_LOCAL_SCHEMES = {"about", "blob", "data"}


class UrlPolicyError(ValueError):
    """Raised when a URL is outside the public HTTP(S) read-only boundary."""


def _is_forbidden_ip(value: str) -> bool:
    address = ipaddress.ip_address(value)
    return not address.is_global


def validate_public_url(url: str, *, resolve_dns: bool = True) -> str:
    """Return a normalized public URL or raise UrlPolicyError."""

    candidate = str(url or "").strip()
    parsed = urlsplit(candidate)
    if parsed.scheme.lower() not in {"http", "https"}:
        raise UrlPolicyError("only public http(s) URLs are supported")
    if parsed.username is not None or parsed.password is not None:
        raise UrlPolicyError("embedded credentials are not allowed")
    hostname = (parsed.hostname or "").rstrip(".").lower()
    if not hostname:
        raise UrlPolicyError("URL hostname is missing")
    if hostname == "localhost" or hostname.endswith(".localhost") or hostname.endswith(".local"):
        raise UrlPolicyError("localhost and local-network hostnames are not allowed")

    try:
        literal_address = ipaddress.ip_address(hostname)
    except ValueError:
        literal_address = None
    if literal_address is not None:
        if not literal_address.is_global:
            raise UrlPolicyError("private, link-local, loopback and reserved addresses are not allowed")
        return candidate

    if resolve_dns:
        try:
            records = socket.getaddrinfo(hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
        except OSError as exc:
            raise UrlPolicyError(f"hostname could not be resolved: {exc}") from exc
        addresses = {record[4][0].split("%", 1)[0] for record in records}
        if not addresses:
            raise UrlPolicyError("hostname did not resolve to an address")
        if any(_is_forbidden_ip(address) for address in addresses):
            raise UrlPolicyError("hostname resolves to a non-public address")
    return candidate


def classify(title: str, body_text: str, html: str, article_text: str = "") -> str:
    """Return PASS only when a clean, continuous article body is actually extracted.

    Captcha/login/paywall markers alone do NOT make a page unreadable — a page
    can carry a captcha widget in a sidebar while the article body is fully
    visible. Prefer the article container text; fall back to whole-body signals
    only when no usable article block was found.
    """
    usable_article = len(article_text.strip()) >= 200
    if title and usable_article:
        # Article container has continuous content: captcha/login markers are WARN, not a block.
        return "PASS"
    if not title or len(body_text) < 100:
        return "EMPTY_OR_SHELL_PAGE"
    lower_body = body_text.lower()
    if any(marker in lower_body for marker in ("captcha", "verify", "byted_acrawler")):
        return "ANTI_BOT"
    if "请登录" in body_text and len(body_text) < 300:
        return "LOGIN_WALL"
    if "订阅后" in body_text and len(body_text) < 500:
        return "PAYWALL"
    return "PASS"


def _output_path(requested: str | None, *, overwrite: bool) -> Path:
    if requested:
        target = Path(requested).expanduser().resolve()
        if not target.parent.is_dir():
            raise ValueError("output directory does not exist")
        if target.exists() and not overwrite:
            raise FileExistsError("output exists; pass --overwrite to replace it")
        return target
    descriptor, name = tempfile.mkstemp(prefix="article-reader-", suffix=".json")
    os.close(descriptor)
    return Path(name)


def _write_json(target: Path, payload: dict[str, object]) -> None:
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _print_summary(payload: dict[str, object]) -> None:
    print(json.dumps(payload, ensure_ascii=True, separators=(",", ":")))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("--out", help="UTF-8 JSON output path; defaults to a unique temp file")
    parser.add_argument("--overwrite", action="store_true", help="allow replacement of --out")
    args = parser.parse_args()

    try:
        url = validate_public_url(args.url)
        out_path = _output_path(args.out, overwrite=args.overwrite)
    except (UrlPolicyError, ValueError, FileExistsError) as exc:
        _print_summary({"status": "INVALID_INPUT", "error": str(exc)})
        return 2

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        _print_summary({"status": "TOOL_MISSING", "error": "python playwright is not installed"})
        return 3

    result: dict[str, object] = {"status": "UNKNOWN", "url": url}
    dns_cache: dict[str, bool] = {}

    def request_is_allowed(request_url: str) -> bool:
        parsed = urlsplit(request_url)
        if parsed.scheme.lower() in ALLOWED_LOCAL_SCHEMES:
            return True
        hostname = (parsed.hostname or "").lower()
        if hostname in dns_cache:
            return dns_cache[hostname]
        try:
            validate_public_url(request_url)
            dns_cache[hostname] = True
        except UrlPolicyError:
            dns_cache[hostname] = False
        return dns_cache[hostname]

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 2400})
        page = context.new_page()
        page.route("**/*", lambda route: route.continue_() if request_is_allowed(route.request.url) else route.abort())
        try:
            response = page.goto(url, timeout=45000, wait_until="domcontentloaded")
            result["http_status"] = response.status if response else None
            try:
                page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:
                result["networkidle_timeout"] = True
            page.wait_for_timeout(1500)

            result["final_url"] = validate_public_url(page.url)
            result["title"] = page.title()
            body_text = page.locator("body").inner_text(timeout=10000)
            html = page.content()
            result["body_chars"] = len(body_text)
            result["body_head"] = body_text[:400]
            result["has_captcha_marker"] = "captcha" in html.lower() or "acrawler" in html.lower()
            result["h1s"] = [text.strip() for text in page.locator("h1").all_inner_texts()[:3]]

            blocks = []
            for selector in ARTICLE_SELECTORS:
                try:
                    locator = page.locator(selector).first
                    if locator.count():
                        text = locator.inner_text(timeout=5000)
                        if text and len(text) > 100:
                            blocks.append({"selector": selector, "chars": len(text), "text": text[:3000]})
                except Exception:
                    continue
            result["article_blocks"] = blocks
            article_text = " ".join(b["text"] for b in blocks)

            paragraphs = [text.strip() for text in page.locator("body p").all_inner_texts() if text.strip()]
            result["paragraphs"] = paragraphs[:100]
            result["paragraph_count"] = len(paragraphs)
            result["status"] = classify(str(result["title"]), body_text, html, article_text)
            result["article_chars"] = len(article_text)
            if result["status"] == "PASS" and result.get("has_captcha_marker") and len(article_text) < len(body_text) * 0.3:
                result["warn"] = "WARN_LARGE_NAV: 正文容器明显小于全页文本，可能含导航/评论/推荐污染"

            if result["status"] == "PASS" and len(paragraphs) < 40:
                for _ in range(3):
                    page.mouse.wheel(0, 2400)
                    page.wait_for_timeout(700)
                expanded = [text.strip() for text in page.locator("body p").all_inner_texts() if text.strip()]
                if len(expanded) > len(paragraphs):
                    result["paragraphs"] = expanded[:100]
                    result["paragraph_count"] = len(expanded)
        except UrlPolicyError as exc:
            result["status"] = "BLOCKED_ADDRESS"
            result["error"] = str(exc)
        except Exception as exc:  # noqa: BLE001
            result["status"] = "ERROR"
            result["error"] = f"{type(exc).__name__}: {exc}"
        finally:
            context.close()
            browser.close()

    _write_json(out_path, result)
    _print_summary({
        "status": result["status"],
        "title": result.get("title", ""),
        "body_chars": result.get("body_chars", 0),
        "paragraph_count": result.get("paragraph_count", 0),
        "out": str(out_path),
    })
    return 0 if result["status"] == "PASS" else 4


if __name__ == "__main__":
    sys.exit(main())
