"""Actual browser regressions for continuation past the former eight-scroll cap."""
import importlib.util, json, sys, unittest
from pathlib import Path
sys.dont_write_bytecode=True
p=Path(__file__).with_name('test-reader-behavior.py')
s=importlib.util.spec_from_file_location('base_tests',p);base=importlib.util.module_from_spec(s);s.loader.exec_module(base)

class Completion(unittest.TestCase):
    setUpClass=classmethod(base.VisibleDOM.setUpClass.__func__)
    tearDownClass=classmethod(base.VisibleDOM.tearDownClass.__func__)
    collect_html=base.VisibleDOM.collect_html
    lazy_html=base.VisibleDOM.lazy_html
    def test_default_continues_beyond_eight_and_twenty_scrolls(self):
        html='<title>长文</title><style>article p{min-height:650px}</style><article>'+''.join('<p>'+base.ARTICLE+f' SECTION_{i}</p>' for i in range(25))+'</article>'
        r=self.collect_html(html)
        self.assertEqual('STABLE_BOTTOM',r['completeness']['stopReason'])
        self.assertGreater(r['completeness']['scrolls'],20)
        self.assertTrue(r['completeness']['atBottom'])
        self.assertTrue(r['article_text'].endswith('SECTION_24'))
        self.assertGreaterEqual(len(r['completeness']['continuations']),2)
    def test_scroll_stall_stops_with_specific_reason(self):
        r=self.collect_html('<title>卡住长文</title><article style="height:20000px"><p>'+base.ARTICLE+'</p></article><script>window.scrollBy=()=>{};</script>')
        self.assertEqual('STALLED_SCROLL',r['completeness']['stopReason'])
        self.assertEqual('partial',r['completeness']['status'])
        self.assertLessEqual(r['completeness']['scrolls'],4)
    def test_lazy_content_after_old_limit_is_retained(self):
        r=self.collect_html(self.lazy_html(12))
        self.assertEqual('STABLE_BOTTOM',r['completeness']['stopReason'])
        self.assertTrue(r['article_text'].endswith('APPENDED_12'))
    def test_explicit_total_budget_still_wins(self):
        r=self.collect_html(self.lazy_html(100),maxScrolls=10)
        self.assertEqual('SCROLL_LIMIT',r['completeness']['stopReason'])
        self.assertEqual(10,r['completeness']['scrolls'])
        self.assertFalse(r['completeness']['fullTextVerified'])
    def test_gate_during_continuation_stops(self):
        html='<title>长文</title><article style="height:20000px"><p>'+base.ARTICLE+'</p></article><script>let n=0;window.addEventListener("scroll",()=>{if(++n===9){document.title="安全验证";document.body.innerHTML="请完成人机验证"}});</script>'
        r=self.collect_html(html)
        self.assertEqual('VISIBLE_GATE',r['completeness']['stopReason'])
        self.assertEqual('CAPTCHA',r['status'])

if __name__=='__main__':unittest.main(verbosity=2)
