# -*- coding: utf-8 -*-
"""
read-article-playwright.py — 只读 Playwright 文章提取器（真实浏览器路线）

适用：微信、今日头条等对无 Cookie HTTP 客户端返回 ANTI_BOT / 空壳的动态页面。
Node 版 read-article.cjs 返回 BLOCKED/ANTI_BOT 或 DYNAMIC_RENDER_REQUIRED 时，
改用本脚本走真实 Chromium 加载可见 DOM。

环境（本机已验证）：
  - Python: C:\\Python314  （python 可直接调用）
  - Playwright: C:\\Python314\\Lib\\site-packages\\playwright
  - Chromium 148: C:\\Users\\admin\\AppData\\Local\\ms-playwright\\chromium-1223

用法：
  python scripts/read-article-playwright.py "https://www.toutiao.com/article/<id>/" [--out <path.json>]

行为（只读）：
  - headless Chromium，不发送 Cookie、不登录、不填表、不下载、不点验证。
  - 等待 networkidle + 短暂沉降，触发懒加载前仅做可见 DOM 提取。
  - 结果写入 UTF-8 JSON 文件（Windows 控制台 GBK 会崩于 ▸ 等字符，禁止直接 print 全文）。
  - stdout 只输出一行状态摘要（含输出文件路径），供上层工具回读。

返回结构：
  status: PASS / ANTI_BOT / EMPTY_OR_SHELL_PAGE / LOGIN_WALL / ERROR
  title, final_url, http_status, body_chars, h1s[], article_blocks[], paragraphs[]
"""
import argparse
import json
import os
import sys
import tempfile

# 头条等页面常见正文容器（按优先级）
ARTICLE_SELECTORS = [
    "article",
    "div.article-content",
    "div[class*='article']",
    "div[class*='ArticleDetail']",
    "div[class*='tt-article']",
    "div[class*='content']",
]

SHELL_MARKERS = [
    "打开app查看全文",
    "打开 App 查看全文",
    "下载app查看",
    "请先 登录 后",
    "验证码",
    "访问验证",
]


def classify(title: str, body_text: str, html: str) -> str:
    if not title or len(body_text) < 100:
        return "EMPTY_OR_SHELL_PAGE"
    lower_body = body_text.lower()
    if any(m in lower_body for m in ("captcha", "verify")):
        return "ANTI_BOT"
    if "请登录" in body_text and len(body_text) < 300:
        return "LOGIN_WALL"
    return "PASS"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--out", default=None, help="输出 JSON 文件路径（默认写系统临时目录）")
    args = ap.parse_args()

    url = args.url.strip()
    if url.startswith("http://") or url.startswith("https://"):
        pass
    else:
        print(json.dumps({"status": "ERROR", "error": "仅支持公开 http(s) URL"}, ensure_ascii=False))
        return 2

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print(json.dumps({"status": "TOOL_MISSING", "error": "python playwright 未安装"}, ensure_ascii=False))
        return 3

    result = {"status": "UNKNOWN", "url": url}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(
            viewport={"width": 1440, "height": 2400},
            user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"),
        )
        try:
            resp = page.goto(url, timeout=45000, wait_until="domcontentloaded")
            result["http_status"] = resp.status if resp else None
            page.wait_for_load_state("networkidle", timeout=30000)
            page.wait_for_timeout(2500)  # 动态内容沉降

            result["final_url"] = page.url
            result["title"] = page.title()

            body_text = page.locator("body").inner_text(timeout=10000)
            result["body_chars"] = len(body_text)
            result["body_head"] = body_text[:400]
            html = page.content()
            result["has_captcha_marker"] = ("captcha" in html.lower()) or ("acrawler" in html.lower())

            h1s = page.locator("h1").all_inner_texts() if page.locator("h1").count() else []
            result["h1s"] = [h.strip() for h in h1s[:3]]

            blocks = []
            for sel in ARTICLE_SELECTORS:
                try:
                    loc = page.locator(sel).first
                    if loc.count():
                        txt = loc.inner_text(timeout=5000)
                        if txt and len(txt) > 100:
                            blocks.append({"selector": sel, "chars": len(txt), "text": txt[:3000]})
                except Exception:
                    continue
            result["article_blocks"] = blocks

            paras = [t.strip() for t in page.locator("body").locator("p").all_inner_texts() if t.strip()]
            result["paragraphs"] = paras[:100]
            result["paragraph_count"] = len(paras)

            imgs = []
            for i in range(min(page.locator("img").count(), 30)):
                imgs.append(page.locator("img").nth(i).get_attribute("alt") or "")
            result["img_alts"] = [a for a in imgs if a][:20]

            result["status"] = classify(result["title"], body_text, html)

            # 懒加载长文：分段滚动一次后再取一次段落（有界，最多 3 屏）
            if result["status"] == "PASS" and result["paragraph_count"] < 40:
                try:
                    for _ in range(3):
                        page.mouse.wheel(0, 2400)
                        page.wait_for_timeout(1200)
                    paras2 = [t.strip() for t in page.locator("body").locator("p").all_inner_texts() if t.strip()]
                    if len(paras2) > len(paras):
                        result["paragraphs"] = paras2[:100]
                        result["paragraph_count"] = len(paras2)
                except Exception:
                    pass

        except Exception as e:  # noqa: BLE001
            result["status"] = "ERROR"
            result["error"] = f"{type(e).__name__}: {e}"
        finally:
            browser.close()

    out_path = args.out or os.path.join(
        tempfile.gettempdir(),
        f"article_result_{abs(hash(url))}.json",
    )
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(json.dumps(result, ensure_ascii=False, indent=1))

    # stdout 只输出摘要，不输出全文（避免 GBK 崩溃）
    print(json.dumps({
        "status": result["status"],
        "title": result.get("title", ""),
        "body_chars": result.get("body_chars", 0),
        "paragraph_count": result.get("paragraph_count", 0),
        "out": out_path,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
