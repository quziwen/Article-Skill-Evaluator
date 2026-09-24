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
from pathlib import Path
import re
import socket
import sys
from urllib.parse import urlsplit


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


GATE_PATTERNS = [
    ("CAPTCHA", r"^(?:(?:请(?:先)?(?:完成|进行|通过)\s*)(?:安全验证|人机验证|验证码)|(?:安全验证|人机验证|验证码|完成验证)(?:$|[：:。！!，,]|后)|verify (?:you are|that you are) human|captcha(?: required| challenge|$))"),
    ("LOGIN_WALL", r"^(?:请(?:先)?登录|登录后(?:查看|阅读)|扫码登录|账号登录|sign in to (?:continue|read)|log in to (?:continue|read))"),
    ("PAYWALL", r"^(?:订阅后|购买后|付费后|订阅以继续|subscribe to (?:continue|read)|purchase to (?:continue|read))"),
    ("PERMISSION_DENIED", r"^(?:无权访问|没有权限|权限不足|访问被拒绝|access denied|permission denied)"),
]


def gate_status(text: str) -> str:
    for status, pattern in GATE_PATTERNS:
        if re.search(pattern, text.strip(), re.IGNORECASE):
            return status
    return ""


def classify(title: str, body_text: str, html: str, article_text: str = "", final_url: str = "", visible_gate: str = "") -> str:
    """A visible gate wins; page-wide widget keywords do not reject real text."""
    if re.search(r"(?:wappoc_appmsgcaptcha|/(?:captcha|verify)(?:/|$))", urlsplit(final_url).path, re.I):
        return "CAPTCHA"
    # Titles must be a gate label, not an article such as '验证码技术原理'.
    title_gate = gate_status(title)
    if title_gate:
        return title_gate
    blocker = gate_status(visible_gate) or gate_status(article_text[:300])
    if blocker:
        return blocker
    if title.strip() and len(article_text.strip()) >= 80:
        return "PASS"
    blocker = gate_status(body_text[:800])
    if blocker:
        return blocker
    if re.search(r"captcha|人机验证|安全验证|验证码|环境异常.*验证", body_text[:800], re.I):
        return "CAPTCHA"
    if re.search(r"byted_acrawler|__ac_signature|anti.?bot", body_text[:800] + html[:2000], re.I):
        return "ANTI_BOT"
    return "EMPTY_OR_SHELL_PAGE"


def _output_path(requested: str | None, *, overwrite: bool) -> Path | None:
    if requested:
        target = Path(requested).expanduser().resolve()
        if not target.parent.is_dir():
            raise ValueError("output directory does not exist")
        if target.exists() and not overwrite:
            raise FileExistsError("output exists; pass --overwrite to replace it")
        return target
    return None


def _write_json(target: Path, payload: dict[str, object], *, overwrite: bool = False) -> None:
    # Exclusive create also protects a file created after the initial path check.
    with target.open("w" if overwrite else "x", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def _print_summary(payload: dict[str, object]) -> None:
    print(json.dumps(payload, ensure_ascii=True, separators=(",", ":")))


def extract_visible_page(page) -> dict[str, object]:
    """Use the same sanitized, single-container extractor as the Node reader."""
    extracted = page.evaluate(Path(__file__).with_name("extract-visible-article.js").read_text(encoding="utf-8"))
    body_text = page.locator("body").inner_text(timeout=10000)
    html = page.content()
    container = extracted.get("container", {})
    paragraphs = [b["text"] for b in extracted["blocks"] if b["type"] == "text"]
    article_text = "\n\n".join(paragraphs) if container.get("matched") else ""
    title = extracted.get("title", "")
    final_url = page.url
    status = classify(page.title() or title, body_text, html, article_text, final_url, extracted.get("visibleGate", ""))
    result = {
        "status": status, "title": title, "final_url": final_url,
        "body_chars": len(body_text), "body_head": body_text[:400],
        "article_text": article_text, "article_chars": len(article_text),
        "paragraphs": paragraphs if article_text else [],
        "paragraph_count": len(paragraphs) if article_text else 0,
        "article_blocks": [{"selector": container.get("selector"), "chars": len(article_text), "text": article_text}] if article_text else [],
        "has_captcha_marker": bool(re.search(r"captcha|acrawler", html, re.I)),
        "extracted": extracted,
    }
    if status == "PASS" and result["has_captcha_marker"]:
        result["warn"] = "PAGE_HAS_CHALLENGE_MARKER_WITH_VISIBLE_ARTICLE"
    return result


def read_article(url: str, timeout_ms: int = 45000) -> dict[str, object]:
    from playwright.sync_api import sync_playwright
    result: dict[str, object] = {"status": "UNKNOWN", "url": url}
    dns_cache: dict[str, bool] = {}

    def request_is_allowed(request_url: str) -> bool:
        parsed = urlsplit(request_url)
        if parsed.scheme.lower() in ALLOWED_LOCAL_SCHEMES:
            return True
        try:
            validate_public_url(request_url, resolve_dns=False)
        except UrlPolicyError:
            return False
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
            response = page.goto(url, timeout=timeout_ms, wait_until="domcontentloaded")
            result["http_status"] = response.status if response else None
            try:
                page.wait_for_load_state("networkidle", timeout=min(5000, timeout_ms))
            except Exception:
                result["networkidle_timeout"] = True
            page.wait_for_timeout(1500)

            validate_public_url(page.url)
            result.update(extract_visible_page(page))
            if result["status"] == "PASS":
                for _ in range(3):
                    page.mouse.wheel(0, 2400)
                    page.wait_for_timeout(700)
                # Re-extract the same container after lazy rendering; never append the whole page.
                result.update(extract_visible_page(page))
        except UrlPolicyError as exc:
            result["status"] = "BLOCKED_ADDRESS"
            result["error"] = str(exc)
        except Exception as exc:  # noqa: BLE001
            result["status"] = "NETWORK_ERROR"
            result["error"] = f"{type(exc).__name__}: {exc}"
        finally:
            context.close()
            browser.close()

    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("url", nargs="?")
    output = parser.add_mutually_exclusive_group()
    output.add_argument("--out", help="explicit UTF-8 JSON output file; otherwise stdout only")
    output.add_argument("--stdout", action="store_true", help="output full JSON without writing a file (default)")
    parser.add_argument("--overwrite", action="store_true", help="allow replacement of --out")
    parser.add_argument("--preflight", action="store_true")
    parser.add_argument("--timeout-ms", type=int, default=45000)
    args = parser.parse_args()
    if args.overwrite and not args.out:
        parser.error("--overwrite requires --out")
    if args.preflight:
        try:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as playwright:
                available = Path(playwright.chromium.executable_path).is_file()
            _print_summary({"available": available, "python": sys.executable, "browserExecutableExists": available, "browserLaunchTested": False})
        except (ImportError, OSError) as exc:
            _print_summary({"available": False, "blocker": "TOOL_MISSING", "error": str(exc)})
        return 0
    if not args.url:
        parser.error("url is required")
    try:
        out_path = _output_path(args.out, overwrite=args.overwrite)
        url = validate_public_url(args.url)
    except (UrlPolicyError, ValueError, FileExistsError) as exc:
        _print_summary({"status": "INVALID_INPUT", "error": str(exc)})
        return 2
    try:
        result = read_article(url, max(5000, min(args.timeout_ms, 120000)))
    except ImportError:
        result = {"status": "TOOL_MISSING", "error": "python playwright is not installed"}
    except Exception as exc:
        result = {"status": "TOOL_ERROR", "error": f"{type(exc).__name__}: {exc}"}
    if out_path:
        try:
            _write_json(out_path, result, overwrite=args.overwrite)
        except (OSError, ValueError) as exc:
            _print_summary({"status": "OUTPUT_ERROR", "error": str(exc)})
            return 2
        _print_summary({"status": result["status"], "title": result.get("title", ""), "article_chars": result.get("article_chars", 0), "paragraph_count": result.get("paragraph_count", 0), "out": str(out_path)})
    else:
        _print_summary(result)
    return 0 if result["status"] == "PASS" else 4


if __name__ == "__main__":
    sys.exit(main())
