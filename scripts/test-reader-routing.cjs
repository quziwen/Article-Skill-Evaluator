'use strict';
const assert = require('node:assert/strict');
const { readArticleAuto, classifyBlocker } = require('./read-article.cjs');

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
  process.stdout.write(JSON.stringify({ status: 'PASS', cases, scope: 'routing decisions with injected readers; live URL tests are separate' }) + '\n');
})().catch((error) => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
