#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const dns = require('node:dns').promises;
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
let outputTarget = null;
const addressPolicy = JSON.parse(fs.readFileSync(path.join(__dirname, 'public-address-policy.json'), 'utf8'));
const addressLists = Object.fromEntries(['ipv4', 'ipv6'].map((family) => [family,
  Object.fromEntries(['blocked', 'exceptions'].map((kind) => {
    const list = new net.BlockList();
    for (const cidr of addressPolicy[family][kind]) {
      const [address, prefix] = cidr.split('/');
      list.addSubnet(address, Number(prefix), family);
    }
    return [kind, list];
  }))
]));

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function emit(value, exitCode = 0) {
  if (outputTarget) {
    const payload = { ...value, runtime: { ...value.runtime, writes: 'explicit-output' }, artifact: { path: outputTarget.path, explicitlyRequested: true } };
    fs.writeFileSync(outputTarget.path, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', flag: outputTarget.overwrite ? 'w' : 'wx' });
    process.stdout.write(`${JSON.stringify({ status: value.status, blocker: value.blocker, title: value.result?.title, attemptedRoute: value.attemptedRoute, attempts: value.attempts, out: outputTarget.path })}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  }
  process.exitCode = exitCode;
}

function loadPlaywright() {
  const failures = [];
  try {
    return { module: require('playwright'), source: 'local-node-resolution' };
  } catch (error) {
    failures.push(`local:${error.code || error.message}`);
  }

  const roots = [
    process.env.ARTICLE_READER_PLAYWRIGHT_ROOT,
    process.env.ARTICLE_SYNC_PLAYWRIGHT_ROOT,
  ].filter(Boolean);
  for (const root of roots) {
    try {
      const packageJson = path.join(path.resolve(root), 'package.json');
      return {
        module: createRequire(packageJson)('playwright'),
        source: `configured-root:${path.resolve(root)}`,
      };
    } catch (error) {
      failures.push(`${root}:${error.code || error.message}`);
    }
  }

  const error = new Error(
    'Playwright is unavailable. Install it in the current project or set ' +
    'ARTICLE_READER_PLAYWRIGHT_ROOT to a trusted project that provides playwright.',
  );
  error.code = 'TOOL_MISSING';
  error.attempts = failures;
  throw error;
}

function probePlaywright() {
  try {
    const loaded = loadPlaywright();
    return { available: true, source: loaded.source };
  } catch (error) {
    return {
      available: false,
      blocker: error.code || 'TOOL_MISSING',
      message: error.message,
      attempts: error.attempts || [],
    };
  }
}

function pythonJson(executable, script, args, timeoutMs) {
  let stdout;
  try {
    stdout = execFileSync(executable, ['-B', '-X', 'utf8', path.join(__dirname, script), ...args], {
      encoding: 'utf8', timeout: timeoutMs, maxBuffer: 12 * 1024 * 1024, windowsHide: true,
    });
  } catch (error) {
    if (!error.stdout) throw error;
    stdout = error.stdout;
  }
  return JSON.parse(stdout);
}

function probePythonPlaywright() {
  const executables = process.env.ARTICLE_READER_PYTHON ? [process.env.ARTICLE_READER_PYTHON] : ['python', 'python3'];
  const attempts = [];
  for (const executable of executables) {
    try {
      const result = pythonJson(executable, 'read-article-playwright.py', ['--preflight'], 10000);
      if (result.available) return { ...result, executable };
      attempts.push({ executable, blocker: result.blocker || 'BROWSER_MISSING' });
    } catch (error) {
      attempts.push({ executable, blocker: error.code || 'TOOL_MISSING' });
    }
  }
  return { available: false, blocker: 'TOOL_MISSING', attempts };
}

function shouldTryBrowser(output) {
  return (output.status === 'PASS' && output.result?.completeness?.status === 'partial') ||
    (output.status === 'BLOCKED' && ['ANTI_BOT', 'CAPTCHA', 'EMPTY_OR_SHELL_PAGE', 'NETWORK_ERROR', 'DYNAMIC_RENDER_REQUIRED'].includes(output.blocker));
}

function attemptSummary(output) {
  return { route: output.attemptedRoute, status: output.status, blocker: output.blocker,
    title: output.result?.title || output.evidence?.title || '',
    textCharacters: output.result?.metrics?.textCharacters || output.evidence?.textCharacters || 0,
    completeness: output.result?.completeness || output.evidence?.completeness };
}

async function readArticleAuto(rawUrl, timeoutMs, adapters = {}) {
  const originalUrl = validateUrl(rawUrl);
  const http = await (adapters.http || readArticleHttp)(originalUrl, timeoutMs);
  const attempts = [attemptSummary(http)];
  if (!shouldTryBrowser(http)) return { ...http, attempts };
  // HTTP challenge pages are preliminary observations. Navigate the original
  // public link once; never navigate a challenge URL or solve/submit anything.
  const browser = await (adapters.browser || readAvailableBrowser)(originalUrl, timeoutMs);
  attempts.push(attemptSummary(browser));
  return { ...browser, initialBlocker: http.blocker || 'PARTIAL_HTTP_CONTENT', attempts,
    ...(http.status === 'PASS' && browser.status !== 'PASS' ? { partialResult: http.result } : {}) };
}

async function readAvailableBrowser(rawUrl, timeoutMs, adapters = {}) {
  const python = (adapters.probePython || probePythonPlaywright)();
  let pythonFailure;
  if (python.available) {
    let output;
    try {
      output = (adapters.pythonJson || pythonJson)(python.executable, 'read-article-playwright.py', [rawUrl, '--stdout', '--timeout-ms', String(timeoutMs)], timeoutMs + Math.min(30000, timeoutMs) + 15000);
    } catch (error) {
      output = { status: error.code === 'ETIMEDOUT' ? 'NETWORK_ERROR' : 'TOOL_ERROR', error: error.code || 'INVALID_OUTPUT' };
    }
    const result = {
      status: output.status === 'PASS' ? 'PASS' : 'BLOCKED',
      ...(output.status === 'PASS' ? {} : { blocker: output.status }),
      attemptedRoute: 'python-playwright-visible-dom', source: sourceKind(rawUrl), requestedUrl: rawUrl,
      ...(output.status === 'PASS' ? { result: { ...output.extracted, articleText: output.article_text, articleCharacters: output.article_chars, completeness: output.completeness, warnings: output.warn ? [output.warn] : [] } } : { evidence: { title: output.title || '', textCharacters: output.article_chars || 0, error: output.error || '', completeness: output.completeness } }),
      runtime: { python: python.executable, cookies: 'temporary-context-only', writes: 'none' },
    };
    // A broken runtime is not evidence that a page is unreadable. Try the other
    // installed runtime once; an actual gate or page result must not be retried.
    if (!['TOOL_ERROR', 'TOOL_MISSING', 'BROWSER_MISSING'].includes(output.status)) return result;
    pythonFailure = result;
  }
  if (!(adapters.probeNode || probePlaywright)().available) return pythonFailure || { status: 'BLOCKED', blocker: 'TOOL_MISSING', attemptedRoute: 'browser-preflight', evidence: { python }, nextAction: 'REPORT_UNAVAILABLE_BROWSER_ROUTE' };
  const readNode = adapters.readNode || (async () => {
    const playwright = loadPlaywright();
    const launched = await launchBrowser(playwright.module.chromium, '', false);
    try {
      return await readArticleBrowser(launched.browser, fs.readFileSync(path.join(__dirname, 'extract-visible-article.js'), 'utf8'), rawUrl, timeoutMs);
    } finally { await launched.browser.close(); }
  });
  let result;
  try {
    result = await readNode(rawUrl, timeoutMs);
  } catch (error) {
    result = { status: 'BLOCKED', blocker: error.code || 'TOOL_ERROR', attemptedRoute: 'playwright-visible-dom', evidence: { error: error.message } };
  }
  return pythonFailure ? { ...result, runtimeAttempts: [attemptSummary(pythonFailure), attemptSummary(result)] } : result;
}

function isPrivateLiteral(hostname) {
  const value = hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local')) return true;
  const version = net.isIP(value);
  if (version === 6) {
    if (value.includes('%')) return true;
    // URL canonicalization handles dotted and expanded IPv4-mapped spellings.
    const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/i.exec(canonical);
    if (mapped) {
      const high = Number.parseInt(mapped[1], 16), low = Number.parseInt(mapped[2], 16);
      return isPrivateLiteral([high >>> 8, high & 255, low >>> 8, low & 255].join('.'));
    }
  }
  if (!version) return false;
  const family = version === 4 ? 'ipv4' : 'ipv6';
  return !addressLists[family].exceptions.check(value, family) && addressLists[family].blocked.check(value, family);
}

function validateUrl(raw) {
  let value;
  try {
    value = new URL(raw);
  } catch {
    const error = new Error('--url must be a valid HTTP(S) URL');
    error.code = 'UNSUPPORTED_FORMAT';
    throw error;
  }
  if (!['http:', 'https:'].includes(value.protocol) || value.username || value.password) {
    const error = new Error('Only credential-free HTTP(S) article URLs are accepted');
    error.code = 'UNSUPPORTED_FORMAT';
    throw error;
  }
  if (isPrivateLiteral(value.hostname)) {
    const error = new Error('Private, local, reserved and multicast destinations are blocked by the read-only crawler');
    error.code = 'PERMISSION_DENIED';
    throw error;
  }
  return value.href;
}

async function validatePublicTarget(raw) {
  const url = validateUrl(raw);
  let addresses;
  try {
    const hostname = new URL(url).hostname.replace(/^\[|\]$/g, '');
    addresses = net.isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    const wrapped = new Error(`DNS lookup failed: ${error.message}`);
    wrapped.code = 'NETWORK_ERROR';
    throw wrapped;
  }
  if (!addresses.length || addresses.some((entry) => !net.isIP(entry.address) || isPrivateLiteral(entry.address))) {
    const error = new Error('The target resolves to a private, loopback, local, or reserved address');
    error.code = 'PERMISSION_DENIED';
    throw error;
  }
  return url;
}

function sourceKind(rawUrl) {
  const hostname = new URL(rawUrl).hostname.toLowerCase();
  if (hostname === 'mp.weixin.qq.com') return 'wechat';
  if (hostname === 'toutiao.com' || hostname.endsWith('.toutiao.com')) return 'toutiao';
  if (hostname === 'zhihu.com' || hostname.endsWith('.zhihu.com')) return 'zhihu';
  return 'standard';
}

function getAttribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : '';
}

function decodeEntities(value) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    hellip: '…',
    ldquo: '“',
    lsquo: '‘',
    lt: '<',
    mdash: '—',
    nbsp: ' ',
    ndash: '–',
    quot: '"',
    rdquo: '”',
    rsquo: '’',
  };
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]+);/gi, (full, token) => {
    if (token[0] === '#') {
      const hex = token[1]?.toLowerCase() === 'x';
      const codePoint = Number.parseInt(token.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (Number.isFinite(codePoint)) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {}
      }
      return full;
    }
    return named[token.toLowerCase()] ?? full;
  });
}

function stripDangerousAndHidden(html) {
  let value = String(html || '');
  value = value.replace(/<(script|style|noscript|template|nav|aside|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  value = value.replace(
    /<([a-z][\w:-]*)\b(?=[^>]*(?:\bhidden\b|\baria-hidden\s*=\s*["']?true|\bstyle\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)))[^>]*>[\s\S]*?<\/\1\s*>/gi,
    '',
  );
  return value;
}

function findElementById(html, id, includeWrapper = false) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const opening = new RegExp(
    `<([a-z][\\w:-]*)\\b[^>]*\\bid\\s*=\\s*(?:"${escapedId}"|'${escapedId}')[^>]*>`,
    'i',
  ).exec(html);
  if (!opening) return '';
  const tagName = opening[1];
  const contentStart = opening.index + opening[0].length;
  const tagPattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'gi');
  tagPattern.lastIndex = contentStart;
  let depth = 1;
  let token;
  while ((token = tagPattern.exec(html))) {
    if (/^<\//.test(token[0])) depth -= 1;
    else if (!/\/>$/.test(token[0])) depth += 1;
    if (depth === 0) return includeWrapper ? html.slice(opening.index, tagPattern.lastIndex) : html.slice(contentStart, token.index);
  }
  return html.slice(includeWrapper ? opening.index : contentStart);
}

function findFirstTag(html, tagName, includeWrapper = false) {
  const opening = new RegExp(`<${tagName}\\b[^>]*>`, 'i').exec(html);
  if (!opening) return '';
  const contentStart = opening.index + opening[0].length;
  const tagPattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'gi');
  tagPattern.lastIndex = contentStart;
  let depth = 1;
  let token;
  while ((token = tagPattern.exec(html))) {
    if (/^<\//.test(token[0])) depth -= 1;
    else if (!/\/>$/.test(token[0])) depth += 1;
    if (depth === 0) return includeWrapper ? html.slice(opening.index, tagPattern.lastIndex) : html.slice(contentStart, token.index);
  }
  return '';
}

function metaContent(html, key) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const marker = getAttribute(tag, 'property') || getAttribute(tag, 'name');
    if (marker.toLowerCase() === key.toLowerCase()) return decodeEntities(getAttribute(tag, 'content')).trim();
  }
  return '';
}

function safeVisibleText(fragment) {
  let value = stripDangerousAndHidden(fragment);
  value = value.replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = decodeEntities(getAttribute(tag, 'alt')).trim();
    return alt ? `\n[图片：${alt}]\n` : '\n';
  });
  value = value.replace(/<a\b[^>]*>([\s\S]*?)<\/a\s*>/gi, (full, labelHtml) => {
    const label = decodeEntities(labelHtml.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const href = getAttribute(full.match(/^<a\b[^>]*>/i)?.[0] || '', 'href');
    const safeHref = /^https?:\/\//i.test(href) ? href : '';
    return safeHref && label ? `${label} (${safeHref})` : label;
  });
  value = value
    .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|main|li|h[1-6]|tr|figure|figcaption|blockquote)\s*>/gi, '\n')
    .replace(/<\/(?:td|th)\s*>/gi, '\t')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(value)
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function findArticleContainer(html) {
  const wechat = findElementById(html, 'js_content', true);
  if (wechat) return { html: wechat, selector: '#js_content' };
  const article = findFirstTag(html, 'article', true);
  if (article) return { html: article, selector: 'article' };
  const main = findFirstTag(html, 'main', true);
  if (main) return { html: main, selector: 'main' };
  const classMatch = /<([a-z][\w:-]*)\b[^>]*\bclass\s*=\s*["'][^"']*(?:article-content|post-content|entry-content|rich_media_content)[^"']*["'][^>]*>/i.exec(html);
  if (classMatch) {
    const synthetic = `${classMatch[0].replace(/>$/, ' id="__article_reader_candidate">')}${html.slice(classMatch.index + classMatch[0].length)}`;
    return { html: findElementById(synthetic, '__article_reader_candidate', true), selector: 'article-content-class', openingTag: classMatch[0] };
  }
  return { html: findFirstTag(html, 'body', true), selector: '' };
}

function htmlContinuationSignals(container, source, containerId) {
  const signals = [];
  const inspect = (html, associatedOnly = false) => {
    for (const match of html.matchAll(/<([a-z][\w:-]*)\b[^>]*>/gi)) {
      const opening = match[0];
      const associated = containerId && decodeEntities(getAttribute(opening, 'aria-controls')).split(/\s+/).includes(containerId);
      if (associatedOnly && !associated) continue;
      if (getAttribute(opening, 'aria-busy').toLowerCase() === 'true') signals.push('BUSY_CONTENT');
      if (!['button', 'a'].includes(match[1].toLowerCase()) && getAttribute(opening, 'role').toLowerCase() !== 'button') continue;
      const label = safeVisibleText(findFirstTag(html.slice(match.index), match[1])).trim();
      if (/^(?:展开全文|阅读全文|显示全文|加载更多|继续阅读|下一页|Show more|Read more|Load more|Continue reading|Next page)$/i.test(label)) signals.push('CONTINUATION_CONTROL');
      if (getAttribute(opening, 'rel').split(/\s+/).includes('next')) signals.push('NEXT_PAGE_LINK');
    }
  };
  inspect(container);
  if (containerId) inspect(source, true);
  return [...new Set(signals)];
}

function parseArticleHtml(html, observedUrl) {
  const source = stripDangerousAndHidden(String(html || ''));
  const selection = findArticleContainer(source);
  const container = selection.html;
  const bodyText = safeVisibleText(container);
  const title = safeVisibleText(findElementById(source, 'activity-name')) ||
    metaContent(source, 'og:title') ||
    metaContent(source, 'twitter:title') ||
    safeVisibleText(findFirstTag(source, 'title'));
  const author = safeVisibleText(findElementById(source, 'js_name')) ||
    metaContent(source, 'author') ||
    metaContent(source, 'article:author');
  const publishedTime = safeVisibleText(findElementById(source, 'publish_time')) ||
    metaContent(source, 'article:published_time') ||
    metaContent(source, 'date');
  const blocks = bodyText
    .split('\n')
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ type: 'text', text }));
  const openingTag = selection.openingTag || container.match(/^<[^>]+>/)?.[0] || '';
  const continuationSignals = htmlContinuationSignals(container, source, decodeEntities(getAttribute(openingTag, 'id')));
  return {
    title,
    author,
    publishedTime,
    observedUrl,
    container: { selector: selection.selector || 'body', matched: Boolean(selection.selector) },
    continuationSignals: [...new Set(continuationSignals)],
    completeness: {
      status: continuationSignals.length ? 'partial' : 'unknown', fullTextVerified: false,
      stopReason: continuationSignals.length ? 'CONTINUATION_PRESENT' : 'HTTP_SNAPSHOT',
      caveat: 'An HTML snapshot cannot verify rendered or source completeness.'
    },
    blocks,
    metrics: {
      textCharacters: bodyText.replace(/\s/g, '').length,
      images: (container.match(/<img\b/gi) || []).length,
      tables: (container.match(/<table\b/gi) || []).length,
    },
    sanitization: {
      contentTrust: 'untrusted_web_content',
      execution: 'none',
      cookies: 'none',
      writes: 'none',
    },
  };
}

function classifyExternalError(message) {
  const value = String(message || '');
  if (/Browser Use rejected this action due to browser security policy|Browser use is not permitted on/i.test(value)) {
    return 'HOST_BROWSER_POLICY';
  }
  return '';
}

async function fetchHtml(rawUrl, timeoutMs, redirectsRemaining = 3) {
  const url = await validatePublicTarget(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5',
        'user-agent': 'ArticleReader/1.1.1 (read-only; no-cookie)',
      },
    });
  } catch (error) {
    const wrapped = new Error(error.name === 'AbortError' ? 'HTTP request timed out' : error.message);
    wrapped.code = 'NETWORK_ERROR';
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location || redirectsRemaining <= 0) {
      const error = new Error('Redirect limit reached or redirect location is missing');
      error.code = 'NETWORK_ERROR';
      throw error;
    }
    return fetchHtml(new URL(location, url).href, timeoutMs, redirectsRemaining - 1);
  }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.code = response.status === 401 || response.status === 403 ? 'PERMISSION_DENIED' : 'NETWORK_ERROR';
    throw error;
  }
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType && !/html|xhtml|text\/plain/.test(contentType)) {
    const error = new Error(`Unsupported content type: ${contentType}`);
    error.code = 'UNSUPPORTED_FORMAT';
    throw error;
  }
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    const error = new Error(`Response exceeds ${MAX_RESPONSE_BYTES} bytes`);
    error.code = 'UNSUPPORTED_FORMAT';
    throw error;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_RESPONSE_BYTES) {
    const error = new Error(`Response exceeds ${MAX_RESPONSE_BYTES} bytes`);
    error.code = 'UNSUPPORTED_FORMAT';
    throw error;
  }
  return {
    html: bytes.toString('utf8'),
    observedUrl: url,
    status: response.status,
    contentType,
  };
}

function classifyBlocker(result, html, navigationError) {
  if (navigationError) {
    if (/timeout/i.test(navigationError)) return 'NETWORK_ERROR';
    return 'NETWORK_ERROR';
  }
  const title = String(result?.title || '');
  const body = (result?.blocks || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join(' ');
  const textCharacters = Number(result?.metrics?.textCharacters || 0);
  const observedUrl = String(result?.observedUrl || '');
  const titleBlocker = /^(?:验证码|人机验证|安全验证|完成验证|请登录|账号登录|访问验证|403 Forbidden|打开\s*App(?:查看全文)?|环境异常)$/i;
  if (titleBlocker.test(title.trim())) {
    if (/验证码|人机验证|安全验证|完成验证/i.test(title)) return 'CAPTCHA';
    if (/登录/i.test(title)) return 'LOGIN_WALL';
    if (/403/i.test(title)) return 'ANTI_BOT';
    return 'EMPTY_OR_SHELL_PAGE';
  }
  if (/wappoc_appmsgcaptcha|[?&](?:captcha|verify)=|\/(?:captcha|verify)(?:\/|$)/i.test(observedUrl)) return 'CAPTCHA';
  const gateLead = result?.visibleGate || body.slice(0, 300);
  if (/^(?:(?:请(?:先)?(?:完成|进行|通过)\s*)(?:安全验证|人机验证|验证码)|(?:安全验证|人机验证|验证码|完成验证)(?:$|[：:。！!，,]|后)|verify (?:you are|that you are) human|captcha(?: required| challenge|$))/i.test(gateLead)) return 'CAPTCHA';
  if (/^(?:请(?:先)?登录|登录后(?:查看|阅读)|扫码登录|账号登录|sign in to (?:continue|read)|log in to (?:continue|read))/i.test(gateLead)) return 'LOGIN_WALL';
  if (/^(?:订阅后|购买后|付费后|subscribe to (?:continue|read))/i.test(gateLead)) return 'PAYWALL';
  if (/^(?:无权访问|没有权限|权限不足|访问被拒绝|access denied|permission denied)/i.test(gateLead)) return 'PERMISSION_DENIED';
  if (result?.container?.matched === false) return 'EMPTY_OR_SHELL_PAGE';
  if (title && textCharacters >= 80 && (result?.blocks?.length || 0) >= 1) return '';

  const visibleLead = `${title}\n${body.slice(0, 800)}`;
  if (/captcha|验证码|人机验证|安全验证|完成验证/i.test(visibleLead)) return 'CAPTCHA';
  if (/请登录|登录后查看|扫码登录|账号登录|sign\s*in|log\s*in/i.test(visibleLead)) return 'LOGIN_WALL';
  if (/付费|订阅后|购买后|会员专享|paywall|subscribe to continue/i.test(visibleLead)) return 'PAYWALL';
  if (/访问过于频繁|anti.?bot|403 Forbidden/i.test(visibleLead)) return 'ANTI_BOT';
  if (/打开\s*App|App\s*内打开|环境异常|访问验证/i.test(visibleLead)) return 'EMPTY_OR_SHELL_PAGE';
  if (!title || textCharacters < 80) {
    if (/byted_acrawler|__ac_signature/i.test(html || '')) return 'ANTI_BOT';
    return 'EMPTY_OR_SHELL_PAGE';
  }
  return '';
}

async function launchBrowser(chromium, requestedChannel, headed) {
  const candidates = requestedChannel ? [requestedChannel] : ['chrome', 'msedge', 'bundled'];
  const failures = [];
  for (const channel of candidates) {
    try {
      const options = { headless: !headed };
      if (channel !== 'bundled') options.channel = channel;
      const browser = await chromium.launch(options);
      return { browser, channel };
    } catch (error) {
      failures.push(`${channel}:${error.message}`);
    }
  }
  const error = new Error(`No Playwright browser could launch: ${failures.join(' | ')}`);
  error.code = 'TOOL_MISSING';
  error.attempts = failures;
  throw error;
}

async function extractPage(page, extractorSource) {
  return page.evaluate((source) => (0, eval)(source), extractorSource);
}

async function runFixture(browser, extractorSource, fixtureName) {
  const fixturePath = path.join(__dirname, 'fixtures', fixtureName);
  const html = fs.readFileSync(fixturePath, 'utf8');
  const page = await browser.newPage();
  try {
    await page.setContent(html);
    return await extractPage(page, extractorSource);
  } finally {
    await page.close();
  }
}

function selfTestHttpParser() {
  const normalHtml = fs.readFileSync(path.join(__dirname, 'fixtures', 'normal.html'), 'utf8');
  const normal = parseArticleHtml(normalHtml, 'https://example.com/normal');
  assert.equal(normal.title, '正常文章夹具');
  assert.equal(normal.author, 'Fixture Author');
  assert.equal(normal.publishedTime, '2026-07-30T09:00:00+08:00');
  assert.ok(normal.metrics.textCharacters >= 180);
  assert.equal(normal.metrics.images, 1);
  assert.equal(normal.metrics.tables, 1);
  assert.equal(normal.sanitization.contentTrust, 'untrusted_web_content');

  const adversarialHtml = fs.readFileSync(path.join(__dirname, 'fixtures', 'adversarial.html'), 'utf8');
  const adversarial = parseArticleHtml(adversarialHtml, 'https://example.com/adversarial');
  const serialized = JSON.stringify(adversarial);
  assert.ok(serialized.includes('IGNORE_PREVIOUS_INSTRUCTIONS_VISIBLE'));
  for (const forbidden of [
    'HIDDEN_SECRET_SENTINEL',
    'SCRIPT_SECRET_SENTINEL',
    'EVENT_HANDLER_SENTINEL',
    'JAVASCRIPT_URL_SENTINEL',
  ]) {
    assert.ok(!serialized.includes(forbidden), `HTTP parser fixture leaked ${forbidden}`);
  }
  const wechatHtml = fs.readFileSync(path.join(__dirname, 'fixtures', 'wechat.html'), 'utf8');
  const wechat = parseArticleHtml(wechatHtml, 'https://mp.weixin.qq.com/s/fixture');
  assert.equal(wechat.title, '微信文章夹具标题');
  assert.equal(wechat.author, '测试公众号');
  assert.equal(wechat.publishedTime, '2026年7月31日 09:00');
  assert.ok(wechat.metrics.textCharacters >= 100);
  assert.equal(
    classifyExternalError(
      'Browser Use rejected this action due to browser security policy. Browser use is not permitted on https://example.com.',
    ),
    'HOST_BROWSER_POLICY',
  );
  assert.equal(sourceKind('https://mp.weixin.qq.com/s/example'), 'wechat');
  return {
    status: 'PASS',
    mode: 'deterministic-http-fixtures',
    results: [
      { name: 'normal', metrics: normal.metrics, sanitization: normal.sanitization },
      { name: 'adversarial', metrics: adversarial.metrics, sanitization: adversarial.sanitization },
      { name: 'wechat', metrics: wechat.metrics, title: wechat.title, author: wechat.author },
      { name: 'host-policy-classification', blocker: 'HOST_BROWSER_POLICY' },
      { name: 'wechat-initial-route', route: 'http-public-html' },
    ],
  };
}

async function selfTestBrowser(browser, extractorSource) {
  const normal = await runFixture(browser, extractorSource, 'normal.html');
  assert.equal(normal.title, '正常文章夹具');
  assert.ok(normal.metrics.textCharacters >= 180);
  assert.equal(normal.metrics.images, 1);
  assert.equal(normal.metrics.tables, 1);
  assert.equal(normal.sanitization.contentTrust, 'untrusted_web_content');

  const adversarial = await runFixture(browser, extractorSource, 'adversarial.html');
  const serialized = JSON.stringify(adversarial);
  assert.ok(serialized.includes('IGNORE_PREVIOUS_INSTRUCTIONS_VISIBLE'));
  for (const forbidden of [
    'HIDDEN_SECRET_SENTINEL',
    'SCRIPT_SECRET_SENTINEL',
    'EVENT_HANDLER_SENTINEL',
    'JAVASCRIPT_URL_SENTINEL',
  ]) {
    assert.ok(!serialized.includes(forbidden), `adversarial fixture leaked ${forbidden}`);
  }
  assert.ok(adversarial.sanitization.excludedNodeCount >= 2);
  assert.ok(adversarial.sanitization.strippedAttributeCount >= 2);
  return {
    status: 'PASS',
    mode: 'deterministic-browser-fixtures',
    results: [
      { name: 'normal', metrics: normal.metrics, sanitization: normal.sanitization },
      { name: 'adversarial', metrics: adversarial.metrics, sanitization: adversarial.sanitization },
    ],
  };
}

async function readArticleHttp(rawUrl, timeoutMs) {
  let fetched;
  try {
    fetched = await fetchHtml(rawUrl, timeoutMs);
  } catch (error) {
    return {
      status: 'BLOCKED',
      blocker: error.code || 'NETWORK_ERROR',
      attemptedRoute: 'http-public-html',
      source: (() => {
        try {
          return sourceKind(validateUrl(rawUrl));
        } catch {
          return 'unknown';
        }
      })(),
      requestedUrl: rawUrl,
      evidence: { error: error.message },
    };
  }
  const result = parseArticleHtml(fetched.html, fetched.observedUrl);
  const blocker = classifyBlocker(result, fetched.html, '');
  if (blocker) {
    return {
      status: 'BLOCKED',
      blocker,
      attemptedRoute: 'http-public-html',
      source: sourceKind(fetched.observedUrl),
      requestedUrl: validateUrl(rawUrl),
      observedUrl: fetched.observedUrl,
      nextAction: ['ANTI_BOT', 'CAPTCHA', 'EMPTY_OR_SHELL_PAGE', 'NETWORK_ERROR'].includes(blocker)
        ? 'TRY_BROWSER_ON_ORIGINAL_URL'
        : 'STOP_AND_REPORT',
      evidence: {
        httpStatus: fetched.status,
        contentType: fetched.contentType,
        title: result.title,
        textCharacters: result.metrics.textCharacters,
      },
    };
  }
  return {
    status: 'PASS',
    attemptedRoute: 'http-public-html',
    source: sourceKind(fetched.observedUrl),
    result,
  };
}

async function readArticleBrowser(browser, extractorSource, rawUrl, timeoutMs) {
  const url = await validatePublicTarget(rawUrl);
  const page = await browser.newPage();
  let navigationError = '';
  let collected;
  const publicHosts = new Map();
  await page.route('**/*', async (route) => {
    try {
      const requestUrl = route.request().url();
      if (/^(?:about|blob|data):/.test(requestUrl)) return route.continue();
      const checked = validateUrl(requestUrl);
      const hostname = new URL(checked).hostname;
      if (!publicHosts.has(hostname)) publicHosts.set(hostname, validatePublicTarget(checked).then(() => true, () => false));
      return await publicHosts.get(hostname) ? route.continue() : route.abort();
    } catch { return route.abort(); }
  });
  try {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await page.waitForTimeout(1200);
      await validatePublicTarget(page.url());
      collected = await page.evaluate(fs.readFileSync(path.join(__dirname, 'collect-visible-article.js'), 'utf8'), { extractorSource, maxElapsedMs: Math.min(30000, timeoutMs) });
    } catch (error) {
      navigationError = error.message;
    }

    let result = null;
    let html = '';
    try {
      result = collected?.extracted || await extractPage(page, extractorSource);
      if (collected) result.completeness = collected.completeness;
      html = await page.content();
    } catch (error) {
      if (!navigationError) navigationError = error.message;
    }

    const blocker = classifyBlocker(result, html, navigationError);
    if (blocker) {
      return {
        status: 'BLOCKED',
        blocker,
        attemptedRoute: 'playwright-visible-dom',
        source: sourceKind(url),
        requestedUrl: url,
        observedUrl: page.url(),
        evidence: {
          title: result?.title || '',
          textCharacters: result?.metrics?.textCharacters || 0,
          navigationError,
          completeness: result?.completeness,
        },
      };
    }
    return {
      status: 'PASS',
      attemptedRoute: 'playwright-visible-dom',
      source: sourceKind(url),
      result,
    };
  } finally {
    await page.close();
  }
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Usage: node scripts/read-article.cjs --preflight');
    console.log('       node scripts/read-article.cjs --url <url> [--mode auto|http|browser] [--out file] [--overwrite] [--timeout-ms 45000]');
    console.log('       node scripts/read-article.cjs --self-test');
    console.log('Default auto: HTTP then one visible-DOM page route; another installed runtime is tried only after a runtime failure. Stdout only unless --out is explicit.');
    return;
  }

  const preflightMode = process.argv.includes('--preflight');
  const selfTestMode = process.argv.includes('--self-test');
  const rawUrl = argValue('--url');
  if (!preflightMode && !selfTestMode && !rawUrl) {
    throw Object.assign(new Error('--url is required'), { code: 'UNSUPPORTED_FORMAT' });
  }
  const timeoutMs = Math.max(5000, Math.min(120000, Number(argValue('--timeout-ms') || 45000)));
  const requestedChannel = argValue('--channel');
  const requestedMode = argValue('--mode') || 'auto';
  if (!['auto', 'http', 'browser'].includes(requestedMode)) {
    throw Object.assign(new Error('--mode must be auto, http or browser'), { code: 'UNSUPPORTED_FORMAT' });
  }
  if (requestedChannel && !['chrome', 'msedge'].includes(requestedChannel)) {
    throw Object.assign(new Error('--channel must be chrome or msedge'), { code: 'UNSUPPORTED_FORMAT' });
  }
  const requestedOut = argValue('--out');
  if (process.argv.includes('--overwrite') && !requestedOut) throw Object.assign(new Error('--overwrite requires --out'), { code: 'INVALID_INPUT' });
  if (process.argv.includes('--out') && (!requestedOut || requestedOut.startsWith('--'))) throw Object.assign(new Error('--out requires a file path'), { code: 'INVALID_INPUT' });
  if (requestedOut) {
    const target = path.resolve(requestedOut);
    const overwrite = process.argv.includes('--overwrite');
    if (!fs.statSync(path.dirname(target)).isDirectory()) throw Object.assign(new Error('Output parent must exist'), { code: 'INVALID_INPUT' });
    if (fs.existsSync(target) && !overwrite) throw Object.assign(new Error('Output exists; explicit --overwrite is required'), { code: 'OUTPUT_EXISTS' });
    outputTarget = { path: target, overwrite };
  }

  const playwrightProbe = probePlaywright();
  if (preflightMode) {
    emit({
      status: 'PASS',
      defaultRoute: 'auto-http-then-visible-dom',
      routes: {
        httpPublicHtml: {
          available: typeof fetch === 'function',
          dependencies: 'node-builtins',
          cookies: 'none',
          writes: 'none',
        },
        playwrightVisibleDom: playwrightProbe,
        pythonPlaywrightVisibleDom: probePythonPlaywright(),
      },
      policy: {
        browserOrder: 'after-purpose-built-connector-api-cli',
        hostBrowserPolicy: 'stop-no-circumvention',
      },
      writes: 'none',
    });
    return;
  }

  const extractorSource = fs.readFileSync(path.join(__dirname, 'extract-visible-article.js'), 'utf8');
  if (selfTestMode) {
    const httpOutput = selfTestHttpParser();
    let browserOutput = {
      status: 'SKIPPED',
      reason: 'Playwright unavailable; HTTP parser and routing fixtures still passed.',
      probe: playwrightProbe,
    };
    const pythonProbe = probePythonPlaywright();
    if (pythonProbe.available) {
      browserOutput = pythonJson(pythonProbe.executable, 'test-reader-behavior.py', ['--json'], 90000);
    } else if (playwrightProbe.available) {
      const playwright = loadPlaywright();
      const launched = await launchBrowser(playwright.module.chromium, requestedChannel, process.argv.includes('--headed'));
      try {
        browserOutput = await selfTestBrowser(launched.browser, extractorSource);
      } finally {
        await launched.browser.close();
      }
    }
    emit({
      status: browserOutput.status === 'PASS' ? 'PASS' : browserOutput.status === 'SKIPPED' ? 'PARTIAL' : 'FAIL',
      mode: 'deterministic-fixtures',
      http: httpOutput,
      browser: browserOutput,
      runtime: {
        playwright: playwrightProbe,
        pythonPlaywright: pythonProbe,
        writes: 'none',
      },
    }, browserOutput.status === 'PASS' ? 0 : 2);
    return;
  }

  if (requestedMode === 'auto') {
    const output = await readArticleAuto(rawUrl, timeoutMs);
    emit(output, output.status === 'PASS' ? 0 : 2);
    return;
  }

  if (requestedMode === 'http') {
    const output = await readArticleHttp(rawUrl, timeoutMs);
    emit({
      ...output,
      runtime: {
        route: 'http-public-html',
        dependencies: 'node-builtins',
        cookies: 'none',
        writes: 'none',
      },
    }, output.status === 'BLOCKED' ? 2 : 0);
    return;
  }

  if (!requestedChannel && !process.argv.includes('--headed')) {
    const output = await readAvailableBrowser(validateUrl(rawUrl), timeoutMs);
    emit(output, output.status === 'PASS' ? 0 : 2);
    return;
  }

  const playwright = loadPlaywright();
  const launched = await launchBrowser(playwright.module.chromium, requestedChannel, process.argv.includes('--headed'));
  try {
    const output = await readArticleBrowser(launched.browser, extractorSource, rawUrl, timeoutMs);
    emit({
      ...output,
      runtime: {
        playwright: playwright.source,
        browserChannel: launched.channel,
        writes: 'none',
      },
    }, output.status === 'BLOCKED' ? 2 : 0);
  } finally {
    await launched.browser.close();
  }
}

module.exports = { readArticleAuto, readAvailableBrowser, shouldTryBrowser, classifyBlocker, probePythonPlaywright, parseArticleHtml, validateUrl, validatePublicTarget, isPrivateLiteral };

if (require.main === module) main().catch((error) => {
  // A failed output write must not retry the same write from the error handler.
  outputTarget = null;
  emit({
    status: 'ERROR',
    blocker: error.code || 'TOOL_ERROR',
    message: error.message,
    attempts: error.attempts || [],
    writes: 'none',
  }, 1);
});

