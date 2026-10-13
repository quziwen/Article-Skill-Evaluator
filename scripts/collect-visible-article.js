// Shared by the Python and Node readers. Only observe and scroll this temporary page.
async ({ extractorSource, maxScrolls = 60, batchScrolls = 8, waitMs = 500, maxElapsedMs = 30000, stableRounds = 2 }) => {
  maxScrolls = Math.max(1, Math.min(120, maxScrolls));
  batchScrolls = Math.max(1, Math.min(maxScrolls, batchScrolls));
  waitMs = Math.max(20, Math.min(1500, waitMs));
  maxElapsedMs = Math.max(50, Math.min(30000, maxElapsedMs));
  stableRounds = Math.max(2, Math.min(4, stableRounds));
  const started = Date.now();
  const history = [];
  const continuations = [];
  let extracted;
  let previousText = '';
  let unchanged = 0;
  let scrolls = 0;
  let stopReason = 'SCROLL_LIMIT';
  let atBottom = false;
  let previousPosition = null;
  let stalledRounds = 0;
  const gate = /^(?:(?:请(?:先)?(?:完成|进行|通过)\s*)(?:安全验证|人机验证|验证码)|(?:安全验证|人机验证|验证码|完成验证)(?:$|[：:。！!，,]|后)|请(?:先)?登录|登录后(?:查看|阅读)|扫码登录|账号登录|订阅后|购买后|付费后|无权访问|权限不足|访问被拒绝|verify (?:you are|that you are) human|captcha(?: required| challenge|$)|(?:sign|log) in to (?:continue|read)|subscribe to (?:continue|read)|access denied|permission denied)/i;
  const observe = () => {
    extracted = (0, eval)(extractorSource);
    const article = extracted.container?.matched;
    const text = article ? extracted.blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '';
    const container = article ? document.querySelector(extracted.container.selector) : null;
    atBottom = container
      ? container.getBoundingClientRect().bottom <= window.innerHeight + 2
      : window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
    const position = `${window.scrollY}:${container?.getBoundingClientRect().bottom}:${document.documentElement.scrollHeight}`;
    stalledRounds = text && !atBottom && text === previousText && position === previousPosition ? stalledRounds + 1 : 0;
    previousPosition = position;
    unchanged = text && text === previousText && atBottom ? unchanged + 1 : 0;
    previousText = text;
    history.push({ scrolls, textCharacters: article ? extracted.metrics.textCharacters : 0, atBottom, elapsedMs: Date.now() - started });
    const gateText = extracted.visibleGate || (article ? text.slice(0, 300) : (document.body?.innerText || '').trim().slice(0, 800));
    return gate.test(document.title.trim()) || gate.test(gateText) ||
      /(?:wappoc_appmsgcaptcha|\/(?:captcha|verify)(?:\/|$))/i.test(location.pathname);
  };
  while (true) {
    if (observe()) { stopReason = 'VISIBLE_GATE'; break; }
    if (Date.now() - started >= maxElapsedMs) { stopReason = 'TIME_LIMIT'; break; }
    if (unchanged >= stableRounds) {
      stopReason = extracted.continuationSignals?.length ? 'CONTINUATION_PRESENT' : 'STABLE_BOTTOM';
      break;
    }
    if (stalledRounds >= 3) { stopReason = 'STALLED_SCROLL'; break; }
    if (scrolls >= maxScrolls) break;
    // A batch boundary is a checkpoint, never a completion signal. Keep this
    // same page/context so lazy-loaded content and scroll position survive.
    if (scrolls > 0 && scrolls % batchScrolls === 0) {
      continuations.push({ afterScroll: scrolls, elapsedMs: Date.now() - started });
    }
    window.scrollBy(0, Math.max(window.innerHeight * 0.85, 600));
    scrolls += 1;
    await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, Math.max(1, maxElapsedMs - (Date.now() - started)))));
  }
  const initial = history[0].textCharacters;
  const final = history[history.length - 1].textCharacters;
  return {
    extracted,
    completeness: {
      status: stopReason === 'VISIBLE_GATE' ? 'blocked' : stopReason === 'STABLE_BOTTOM' ? 'observed-stable' : final ? 'partial' : 'unknown',
      fullTextVerified: false,
      stopReason, scrolls, snapshots: history.length, atBottom,
      initialTextCharacters: initial, finalTextCharacters: final,
      contentGrew: final > initial, elapsedMs: Date.now() - started,
      limits: { maxScrolls, batchScrolls, waitMs, maxElapsedMs, stableRounds },
      continuations,
      observations: history,
      caveat: 'Visible DOM only. A stable article bottom does not prove source completeness; pagination, delayed content and image-only text may remain.'
    }
  };
}
