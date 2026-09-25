'use strict';
const assert = require('node:assert/strict');
const dns = require('node:dns').promises;
const fixtures = require('./fixtures/url-policy-cases.json');
const { isPrivateLiteral, validateUrl, validatePublicTarget, readArticleAuto } = require('./read-article.cjs');

(async () => {
  let cases = 0;
  for (const fixture of fixtures) {
    const host = fixture.address.includes(':') ? `[${fixture.address}]` : fixture.address;
    const url = `https://${host}/article`;
    assert.equal(!isPrivateLiteral(fixture.address), fixture.allowed, fixture.address);
    if (fixture.allowed) assert.ok(validateUrl(url));
    else assert.throws(() => validateUrl(url), { code: 'PERMISSION_DENIED' });
    cases++;
  }
  const originalLookup = dns.lookup;
  const originalFetch = global.fetch;
  const fetchCalls = [];
  try {
    dns.lookup = async (hostname) => hostname === 'safe.example'
      ? [{ address: '8.8.8.8', family: 4 }]
      : [{ address: '8.8.8.8', family: 4 }, { address: '192.0.2.1', family: 4 }];
    global.fetch = async (url) => {
      fetchCalls.push(url);
      return new Response(null, { status: 302, headers: { location: 'http://192.0.2.1/article' } });
    };
    await assert.rejects(readArticleAuto('http://192.0.2.1/article', 5000), { code: 'PERMISSION_DENIED' });
    assert.equal(fetchCalls.length, 0, 'a blocked literal must not reach fetch');
    cases++;
    await assert.rejects(validatePublicTarget('https://mixed.example/article'), { code: 'PERMISSION_DENIED' });
    assert.equal(fetchCalls.length, 0, 'a DNS result with any non-public address must not reach fetch');
    cases++;
    const redirected = await readArticleAuto('https://safe.example/article', 5000);
    assert.equal(redirected.status, 'BLOCKED');
    assert.equal(redirected.blocker, 'PERMISSION_DENIED');
    assert.deepEqual(fetchCalls, ['https://safe.example/article']);
    cases++;
    assert.equal(await validatePublicTarget('https://[2001:4860:4860::8888]/article'), 'https://[2001:4860:4860::8888]/article');
    cases++;
  } finally {
    dns.lookup = originalLookup;
    global.fetch = originalFetch;
  }
  console.log(JSON.stringify({ status: 'PASS', cases, addressCases: fixtures.length, network: 'DNS and fetch mocked; no external requests', scope: 'Node address policy and HTTP redirect checks; native Node browser not launched' }));
})().catch((error) => { console.error(error.stack); process.exitCode = 1; });
