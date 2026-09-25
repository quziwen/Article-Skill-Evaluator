'use strict';
const assert = require('node:assert/strict');
const { readArticleAuto, readAvailableBrowser, shouldTryBrowser, classifyBlocker, parseArticleHtml } = require('./read-article.cjs');

(async () => {
  let cases = 0;
  const url = 'https://mp.weixin.qq.com/s/example';
  for (const blocker of ['ANTI_BOT', 'CAPTCHA', 'EMPTY_OR_SHELL_PAGE', 'NETWORK_ERROR']) {
    const calls = [];
    const result = await readArticleAuto(url, 5000, {
      http: async (target) => { calls.push(['http', target]); return { status: 'BLOCKED', blocker, attemptedRoute: 'http-public-html', observedUrl: 'https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha?token=unused' }; },
      browser: async (target) => { calls.push(['browser', target]); return { status: 'PASS', attemptedRoute: 'python-playwright-visible-dom', result: { title: '实际正文', metrics: { textCharacters: 300 } } }; },
    });
    assert.deepEqual(calls, [['http', url], ['browser', url]]);
    assert.equal(result.status, 'PASS');
    assert.equal(result.attempts.length, 2);
    cases++;
  }
  for (const blocker of ['LOGIN_WALL', 'PAYWALL', 'PERMISSION_DENIED', 'HOST_BROWSER_POLICY', 'INVALID_INPUT']) {
    let browserCalls = 0;
    const result = await readArticleAuto(url, 5000, {
      http: async () => ({ status: 'BLOCKED', blocker, attemptedRoute: 'http-public-html' }),
      browser: async () => { browserCalls++; throw Error('unexpected browser call'); },
    });
    assert.equal(browserCalls, 0);
    assert.equal(result.blocker, blocker);
    cases++;
  }
  for (const browserBlocker of ['CAPTCHA', 'HOST_BROWSER_POLICY', 'TOOL_MISSING']) {
    let browserCalls = 0;
    const result = await readArticleAuto(url, 5000, {
      http: async () => ({ status: 'BLOCKED', blocker: 'ANTI_BOT', attemptedRoute: 'http-public-html' }),
      browser: async () => { browserCalls++; return { status: 'BLOCKED', blocker: browserBlocker, attemptedRoute: 'browser' }; },
    });
    assert.equal(browserCalls, 1);
    assert.equal(result.blocker, browserBlocker);
    cases++;
  }
  await readArticleAuto(url, 5000, {
    http: async () => ({ status: 'PASS', attemptedRoute: 'http-public-html' }),
    browser: async () => { throw Error('HTTP success must not launch browser'); },
  });
  cases++;
  for (const [text, expected] of [['请登录后查看全文。'.repeat(45), 'LOGIN_WALL'], ['请完成安全验证后继续阅读全文。'.repeat(12), 'CAPTCHA']]) {
    assert.equal(classifyBlocker({ title: '文章标题', blocks: [{ type: 'text', text }], metrics: { textCharacters: text.length } }, '', ''), expected);
    cases++;
  }
  const shell = parseArticleHtml('<title>站点导航</title><body><nav>' + '菜单 新闻 推荐 '.repeat(80) + '</nav></body>', url);
  assert.equal(classifyBlocker(shell, '', ''), 'EMPTY_OR_SHELL_PAGE');
  cases++;
  const mainNavigation = parseArticleHtml('<title>主区域导航</title><body><main><nav>' + '菜单 新闻 推荐 '.repeat(80) + '</nav></main></body>', url);
  assert.equal(classifyBlocker(mainNavigation, '', ''), 'EMPTY_OR_SHELL_PAGE');
  cases++;
  const preview = parseArticleHtml('<title>文章预览</title><article><p>' + '足够长但仍不是全文的预览。'.repeat(20) + '</p><button>阅读全文</button></article>', url);
  assert.equal(preview.completeness.status, 'partial');
  assert.equal(preview.completeness.fullTextVerified, false);
  for (const [attributes, inside, outside, expectedPartial] of [
    ['aria-busy="true"', '', '', true],
    ['', '<div role="button"><span>Read more</span></div>', '', true],
    ['', '', '<button aria-controls="other story">Read more</button>', true],
    ['', '', '<aside><button>Read more</button></aside>', false],
    ['', '', '<button aria-controls="other">Read more</button>', false],
    ['', '', '<button aria-controls="story" hidden>Read more</button>', false],
  ]) {
    const parsed = parseArticleHtml(`<title>文章预览</title><article id="story" ${attributes}><p>${'足够长的文章正文。'.repeat(20)}</p>${inside}</article>${outside}`, url);
    assert.equal(parsed.completeness.status, expectedPartial ? 'partial' : 'unknown');
    assert.equal(shouldTryBrowser({ status: 'PASS', result: parsed }), expectedPartial);
    cases++;
  }
  const callOrder = [];
  const recovered = await readArticleAuto(url, 5000, {
    http: async () => { callOrder.push('http'); return { status: 'PASS', attemptedRoute: 'http-public-html', result: preview }; },
    browser: async () => { callOrder.push('browser'); return { status: 'PASS', attemptedRoute: 'browser', result: { metrics: { textCharacters: 1000 } } }; },
  });
  assert.deepEqual(callOrder, ['http', 'browser']);
  assert.equal(recovered.initialBlocker, 'PARTIAL_HTTP_CONTENT');
  cases++;
  const unavailable = await readArticleAuto(url, 5000, {
    http: async () => ({ status: 'PASS', attemptedRoute: 'http-public-html', result: preview }),
    browser: async () => ({ status: 'BLOCKED', blocker: 'TOOL_MISSING', attemptedRoute: 'browser' }),
  });
  assert.equal(unavailable.status, 'BLOCKED');
  assert.equal(unavailable.partialResult, preview);
  cases++;
  for (const pythonStatus of ['TOOL_ERROR', 'CAPTCHA', 'EMPTY_OR_SHELL_PAGE', 'NETWORK_ERROR']) {
    let nodeCalls = 0;
    const output = await readAvailableBrowser(url, 5000, {
      probePython: () => ({ available: true, executable: 'fixture-python' }),
      pythonJson: () => ({ status: pythonStatus }),
      probeNode: () => ({ available: true }),
      readNode: async () => { nodeCalls++; return { status: 'PASS', attemptedRoute: 'playwright-visible-dom' }; },
    });
    assert.equal(nodeCalls, pythonStatus === 'TOOL_ERROR' ? 1 : 0);
    assert.equal(output.status, pythonStatus === 'TOOL_ERROR' ? 'PASS' : 'BLOCKED');
    if (pythonStatus === 'TOOL_ERROR') assert.equal(output.runtimeAttempts.length, 2);
    cases++;
  }
  process.stdout.write(JSON.stringify({ status: 'PASS', cases, scope: 'routing decisions with injected readers; live URL tests are separate' }) + '\n');
})().catch((error) => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
