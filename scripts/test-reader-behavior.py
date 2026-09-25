"""Regression tests for real reading decisions and local visible DOM extraction."""
from __future__ import annotations

import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("reader", ROOT / "read-article-playwright.py")
READER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(READER)
ARTICLE = "这是一段完整的文章正文，描述实际业务问题、已知证据和实施条件，正文内容不应与侧栏提示混在一起。" * 5


class Decisions(unittest.TestCase):
    def test_real_gates_without_article(self):
        for title, text, expected in [
            ("安全验证", "请完成安全验证后继续阅读全文。" * 12, "CAPTCHA"),
            ("账号登录", "请登录后查看全文。" * 45, "LOGIN_WALL"),
            ("订阅后阅读", "订阅后继续阅读全文。" * 30, "PAYWALL"),
            ("访问被拒绝", "权限不足，请联系管理员。" * 30, "PERMISSION_DENIED"),
        ]:
            with self.subTest(expected=expected):
                self.assertEqual(expected, READER.classify(title, text, ""))

    def test_widget_and_topic_are_not_gates(self):
        self.assertEqual("PASS", READER.classify("正常文章", ARTICLE + " captcha", "captcha widget", ARTICLE))
        self.assertEqual("PASS", READER.classify("验证码技术原理", ARTICLE, "", ARTICLE))

    def test_missing_container_is_not_success(self):
        self.assertEqual("EMPTY_OR_SHELL_PAGE", READER.classify("站点导航", "新闻 菜单 推荐 链接 " * 100, ""))

    def test_actual_captcha_destination_and_visible_dialog_win(self):
        self.assertEqual("CAPTCHA", READER.classify("正常文章", ARTICLE, "", ARTICLE, "https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha"))
        self.assertEqual("LOGIN_WALL", READER.classify("正常文章", ARTICLE, "", ARTICLE, visible_gate="请登录后查看全文"))

    def test_default_output_is_stdout_and_explicit_output_refuses_overwrite(self):
        self.assertIsNone(READER._output_path(None, overwrite=False))
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "protected.json"
            target.write_bytes(b"original")
            run = subprocess.run([sys.executable, "-B", str(ROOT / "read-article-playwright.py"), "https://example.com/article", "--out", str(target)], capture_output=True)
            self.assertNotEqual(0, run.returncode)
            self.assertEqual(b"original", target.read_bytes())
            self.assertEqual("INVALID_INPUT", json.loads(run.stdout)["status"])
            self.assertEqual([target], list(Path(directory).iterdir()))
            # Recheck exclusive creation even if the file appeared after preflight.
            with self.assertRaises(FileExistsError):
                READER._write_json(target, {"changed": True})


class VisibleDOM(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from playwright.sync_api import sync_playwright
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True)
        cls.context = cls.browser.new_context()
        cls.context.route("**/*", lambda route: route.abort())

    @classmethod
    def tearDownClass(cls):
        cls.context.close()
        cls.browser.close()
        cls.playwright.stop()

    def read_html(self, html):
        page = self.context.new_page()
        try:
            page.set_content(html)
            return READER.extract_visible_page(page)
        finally:
            page.close()

    def collect_html(self, html, **limits):
        page = self.context.new_page()
        try:
            page.set_viewport_size({"width": 900, "height": 600})
            page.set_content(html)
            page.evaluate("window.__testClicks = 0; document.addEventListener('click', () => window.__testClicks++);")
            result = READER.collect_visible_page(page, waitMs=80, **limits)
            result["test_click_count"] = page.evaluate("window.__testClicks")
            return result
        finally:
            page.close()

    def test_delayed_dynamic_article_is_waited_for(self):
        html = '<title>动态正文</title><main id="mount">加载中</main><script>setTimeout(() => { document.querySelector("#mount").innerHTML = ' + json.dumps(f'<article><p>{ARTICLE}</p><p>DYNAMIC_END</p></article>') + '; }, 100);</script>'
        result = self.collect_html(html)
        self.assertEqual("PASS", result["status"])
        self.assertIn("DYNAMIC_END", result["article_text"])
        self.assertTrue(result["completeness"]["contentGrew"])
        self.assertEqual("STABLE_BOTTOM", result["completeness"]["stopReason"])
        self.assertFalse(result["completeness"]["fullTextVerified"])

    def lazy_html(self, batches):
        return '<title>滚动加载正文</title><style>article p { min-height: 650px; }</style><article><p>' + ARTICLE + '</p></article><script>let batches = 0; window.addEventListener("scroll", () => { if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 30 && batches < ' + str(batches) + ') { batches++; const p = document.createElement("p"); p.textContent = ' + json.dumps(ARTICLE) + ' + " APPENDED_" + batches; document.querySelector("article").appendChild(p); } });</script>'

    def test_long_article_scrolls_until_stable_and_keeps_order(self):
        result = self.collect_html(self.lazy_html(3))
        self.assertEqual("PASS", result["status"])
        self.assertEqual(4, result["paragraph_count"])
        self.assertTrue(result["article_text"].endswith("APPENDED_3"))
        self.assertLess(result["article_text"].index("APPENDED_1"), result["article_text"].index("APPENDED_2"))
        self.assertEqual("STABLE_BOTTOM", result["completeness"]["stopReason"])
        self.assertTrue(result["completeness"]["contentGrew"])

    def test_infinite_article_stops_at_scroll_limit_and_reports_partial(self):
        result = self.collect_html(self.lazy_html(100), maxScrolls=4)
        self.assertEqual("PASS", result["status"])
        self.assertEqual("partial", result["completeness"]["status"])
        self.assertEqual("SCROLL_LIMIT", result["completeness"]["stopReason"])
        self.assertEqual(4, result["completeness"]["scrolls"])
        self.assertFalse(result["completeness"]["fullTextVerified"])

    def test_time_limit_is_recorded_without_claiming_completion(self):
        result = self.collect_html(self.lazy_html(100), maxElapsedMs=60)
        self.assertEqual("TIME_LIMIT", result["completeness"]["stopReason"])
        self.assertLessEqual(result["completeness"]["scrolls"], 1)
        self.assertEqual("partial", result["completeness"]["status"])

    def test_captcha_page_is_not_scrolled_or_read_as_article(self):
        result = self.collect_html('<title>安全验证</title><form>请完成人机验证后继续阅读</form><article><p>' + ARTICLE + '</p></article>')
        self.assertEqual("CAPTCHA", result["status"])
        self.assertEqual("VISIBLE_GATE", result["completeness"]["stopReason"])
        self.assertEqual(0, result["completeness"]["scrolls"])

    def test_continuation_control_is_reported_without_clicking(self):
        result = self.collect_html('<title>部分正文</title><article><p>' + ARTICLE + '</p><button onclick="document.body.innerHTML = \'UNWANTED_ACTION\'">阅读全文</button></article>')
        self.assertEqual("PASS", result["status"])
        self.assertEqual("CONTINUATION_PRESENT", result["completeness"]["stopReason"])
        self.assertEqual("partial", result["completeness"]["status"])
        self.assertNotIn("UNWANTED_ACTION", result["article_text"])

    def test_unrendered_shell_is_bounded_and_never_complete(self):
        result = self.collect_html('<title>加载页面</title><div>加载中</div>', maxScrolls=3)
        self.assertEqual("EMPTY_OR_SHELL_PAGE", result["status"])
        self.assertEqual("unknown", result["completeness"]["status"])
        self.assertEqual("SCROLL_LIMIT", result["completeness"]["stopReason"])
        self.assertEqual(3, result["completeness"]["scrolls"])

    def test_root_busy_and_associated_controls_remain_partial(self):
        for attributes, inside, outside, expected_signal in [
            ('aria-busy="true"', '', '', 'BUSY_CONTENT'),
            ('', '<div aria-busy="true">仍在加载</div>', '', 'BUSY_CONTENT'),
            ('', '<div role="button">Read more</div>', '', 'CONTINUATION_CONTROL'),
            ('', '', '<button aria-controls="other story">Read more</button>', 'CONTINUATION_CONTROL'),
        ]:
            with self.subTest(attributes=attributes, inside=inside, outside=outside):
                result = self.collect_html(f'<title>部分正文</title><article id="story" {attributes}><p>{ARTICLE}</p>{inside}</article>{outside}')
                self.assertEqual("PASS", result["status"])
                self.assertIn(expected_signal, result["extracted"]["continuationSignals"])
                self.assertEqual("partial", result["completeness"]["status"])
                self.assertEqual("CONTINUATION_PRESENT", result["completeness"]["stopReason"])
                self.assertEqual(0, result["test_click_count"])

    def test_unrelated_or_hidden_external_controls_do_not_make_article_partial(self):
        for outside in [
            '<aside><button>Read more</button></aside>',
            '<button aria-controls="other">Read more</button>',
            '<button aria-controls="story" style="display:none">Read more</button>',
            '<div hidden><button aria-controls="story">Read more</button></div>',
        ]:
            with self.subTest(outside=outside):
                result = self.collect_html(f'<title>可见正文</title><article id="story"><p>{ARTICLE}</p></article>{outside}')
                self.assertEqual([], result["extracted"]["continuationSignals"])
                self.assertEqual("observed-stable", result["completeness"]["status"])
                self.assertEqual(0, result["test_click_count"])

    def test_wechat_container_metadata_and_order(self):
        result = self.read_html((ROOT / "fixtures/wechat.html").read_text(encoding="utf-8"))
        self.assertEqual("PASS", result["status"])
        self.assertEqual("#js_content", result["article_blocks"][0]["selector"])
        self.assertEqual("测试公众号", result["extracted"]["author"])
        self.assertEqual(3, result["paragraph_count"])
        self.assertEqual(len(result["article_text"]), result["article_chars"])

    def test_nested_article_is_counted_once_and_not_truncated(self):
        text = "完整正文不能在三千字符处被静默截断。" * 250
        result = self.read_html(f'<title>长文章</title><div class="article-content"><article><blockquote><p>{text}</p></blockquote><p>真实结束标志 END_OF_ARTICLE</p></article></div><aside>推荐广告</aside>')
        self.assertEqual("PASS", result["status"])
        self.assertEqual(1, len(result["article_blocks"]))
        self.assertEqual(text + "\n\n真实结束标志 END_OF_ARTICLE", result["article_text"])
        self.assertNotIn("推荐广告", result["article_text"])

    def test_widget_outside_article_does_not_block(self):
        result = self.read_html(f'<title>正常文章</title><article><p>{ARTICLE}</p></article><aside>captcha 验证码</aside>')
        self.assertEqual("PASS", result["status"])
        self.assertEqual(ARTICLE, result["article_text"])

    def test_visible_gates_and_navigation_do_not_become_article(self):
        for title, text, expected in [
            ("安全验证", "请完成安全验证后继续阅读全文。" * 12, "CAPTCHA"),
            ("账号登录", "请登录后查看全文。" * 45, "LOGIN_WALL"),
            ("新闻首页", "菜单 推荐 登录 " * 70, "EMPTY_OR_SHELL_PAGE"),
        ]:
            with self.subTest(expected=expected):
                result = self.read_html(f'<title>{title}</title><div><p>{text}</p></div>')
                self.assertEqual(expected, result["status"])

    def test_visible_login_dialog_over_article_blocks(self):
        result = self.read_html(f'<title>正文标题</title><article><p>{ARTICLE}</p></article><div role="dialog">请登录后查看全文</div>')
        self.assertEqual("LOGIN_WALL", result["status"])

    def test_hidden_login_dialog_does_not_block(self):
        for style in ["display:none", "visibility:hidden", "opacity:0"]:
            result = self.read_html(f'<title>正文标题</title><article><p>{ARTICLE}</p></article><div role="dialog" style="{style}">请登录后查看全文</div>')
            self.assertEqual("PASS", result["status"])

    def test_english_login_dialog_over_article_blocks(self):
        result = self.read_html(f'<title>Article</title><article><p>{ARTICLE}</p></article><form>Log in to continue</form>')
        self.assertEqual("LOGIN_WALL", result["status"])

    def test_normal_metadata_media_and_adversarial_sanitization(self):
        normal = self.read_html((ROOT / "fixtures/normal.html").read_text(encoding="utf-8"))
        self.assertEqual("PASS", normal["status"])
        self.assertEqual(1, normal["extracted"]["metrics"]["tables"])
        self.assertEqual(1, normal["extracted"]["metrics"]["images"])
        result = self.read_html((ROOT / "fixtures/adversarial.html").read_text(encoding="utf-8"))
        serialized = json.dumps(result["extracted"], ensure_ascii=False)
        self.assertIn("IGNORE_PREVIOUS_INSTRUCTIONS_VISIBLE", serialized)
        for marker in ["HIDDEN_SECRET_SENTINEL", "SCRIPT_SECRET_SENTINEL", "EVENT_HANDLER_SENTINEL", "JAVASCRIPT_URL_SENTINEL"]:
            self.assertNotIn(marker, serialized)


if __name__ == "__main__":
    stream = io.StringIO() if "--json" in sys.argv else sys.stderr
    result = unittest.TextTestRunner(stream=stream, verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]))
    if "--json" in sys.argv:
        print(json.dumps({"status": "PASS" if result.wasSuccessful() else "FAIL", "mode": "python-visible-dom-and-decisions", "tests": result.testsRun, "failures": len(result.failures), "errors": len(result.errors), "details": stream.getvalue()}, ensure_ascii=True))
    sys.exit(0 if result.wasSuccessful() else 1)
