(() => {
  const selectors = [
    '#js_content', '#article-content', 'article',
    '[class*="article"]', '[class*="content"]', '[class*="post"]',
    '.rich_media_content', '.article-content', '.post-content',
    '.entry-content', '.story-body', '#content', '.content-body',
    '.article-body', '[class*="story"]', 'main',
    '#page-content', '.text-content', '#read-content',
    '.detail-content', '.main-content', '.page-content'
  ];

  const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const absoluteUrl = (url) => {
    if (!url || url.startsWith('data:')) return '';
    try { return new URL(url, location.href).href; } catch { return url; }
  };

  let container = null;
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && clean(el.innerText).length > 100) {
      container = el;
      break;
    }
  }

  if (!container) {
    let maxLen = 0;
    document.querySelectorAll('div, section').forEach((el) => {
      const len = clean(el.innerText).length;
      if (len > maxLen && len > 300) {
        maxLen = len;
        container = el;
      }
    });
  }
  if (!container) container = document.body;

  const jsonLdArticles = [];
  const collectJsonLd = (value) => {
    if (Array.isArray(value)) {
      value.forEach(collectJsonLd);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value['@graph'])) value['@graph'].forEach(collectJsonLd);
    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
    if (types.some((type) => /Article$/i.test(String(type || ''))) || value.headline || value.datePublished) {
      jsonLdArticles.push(value);
    }
  };
  document.querySelectorAll('script[type="application/ld+json"]').forEach((node) => {
    try { collectJsonLd(JSON.parse(node.textContent || 'null')); } catch {}
  });
  const jsonLdArticle = jsonLdArticles.find((item) => {
    const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
    return types.some((type) => /(?:News)?Article$/i.test(String(type || '')));
  }) || jsonLdArticles[0] || {};
  const jsonLdAuthors = Array.isArray(jsonLdArticle.author) ? jsonLdArticle.author : [jsonLdArticle.author];
  const jsonLdAuthor = jsonLdAuthors
    .map((item) => typeof item === 'string' ? item : item?.name)
    .map(clean)
    .filter(Boolean)
    .join(', ');
  const chooseMetadata = (candidates) => {
    for (const candidate of candidates) {
      const value = clean(candidate.value);
      if (value) return { value, source: candidate.source };
    }
    return { value: '', source: 'missing' };
  };

  const titleMetadata = chooseMetadata([
    { value: document.querySelector('meta[property="og:title"]')?.content, source: 'meta_og' },
    { value: jsonLdArticle.headline || jsonLdArticle.name, source: 'json_ld' },
    { value: document.querySelector('h1')?.innerText, source: 'h1' },
    { value: document.title, source: 'document_title' },
  ]);
  const authorMetadata = chooseMetadata([
    { value: document.querySelector('meta[name="author"]')?.content, source: 'meta_author' },
    { value: jsonLdAuthor, source: 'json_ld' },
    { value: document.querySelector('[class*="author"]')?.innerText, source: 'dom_author' },
    { value: document.querySelector('[class*="writer"]')?.innerText, source: 'dom_writer' },
  ]);
  const publishTimeMetadata = chooseMetadata([
    { value: document.querySelector('meta[property="article:published_time"]')?.content, source: 'meta_published_time' },
    { value: jsonLdArticle.datePublished, source: 'json_ld' },
    { value: document.querySelector('time')?.getAttribute('datetime'), source: 'time_datetime' },
    { value: document.querySelector('time')?.innerText, source: 'time_text' },
    { value: document.querySelector('[class*="time"]')?.innerText, source: 'dom_time' },
  ]);

  const canonicalUrl = (() => {
    try {
      const value = new URL(location.href);
      if (/^(www\.)?toutiao\.com$/i.test(value.hostname) && /^\/article\/\d+\/?$/.test(value.pathname)) {
        value.search = '';
        value.hash = '';
      }
      return value.href;
    } catch {
      return location.href;
    }
  })();

  const blocks = [];
  const seenNodes = [];
  let excludedNodeCount = 0;
  const excludedReasons = {};
  let strippedAttributeCount = 0;

  const hasSeen = (node) => seenNodes.indexOf(node) !== -1;
  const markSeen = (node) => {
    if (!hasSeen(node)) seenNodes.push(node);
  };
  const recordExclusion = (reason) => {
    excludedNodeCount += 1;
    excludedReasons[reason] = (excludedReasons[reason] || 0) + 1;
  };

  const hiddenReason = (node) => {
    const tag = node.tagName.toLowerCase();
    let current = node;
    while (current) {
      const currentTag = current.tagName.toLowerCase();
      if (
        current.hasAttribute('hidden') ||
        current.getAttribute('aria-hidden') === 'true' ||
        current.hasAttribute('inert') ||
        currentTag === 'template'
      ) {
        return 'hidden_attribute';
      }
      if (
        ['script', 'style', 'noscript', 'template', 'iframe', 'svg', 'canvas', 'nav', 'footer', 'header', 'aside']
          .includes(currentTag)
      ) {
        return 'non_content_ancestor';
      }
      const style = window.getComputedStyle(current);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0' ||
        style.fontSize === '0px'
      ) {
        return 'hidden_style';
      }
      if (current === container) break;
      current = current.parentElement;
    }
    if (!['img', 'svg', 'canvas'].includes(tag)) {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0 && clean(node.innerText)) {
        return 'zero_sized_text';
      }
    }
    return '';
  };

  const candidateSelector = [
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'img', 'blockquote', 'li', 'pre', 'table', 'figure', 'figcaption'
  ].join(', ');
  const candidateNodes = Array.from(container.querySelectorAll(candidateSelector));

  const pushImage = (img) => {
    const src = absoluteUrl(
      img.getAttribute('data-src') ||
      img.getAttribute('data-original') ||
      img.getAttribute('data-original-src') ||
      img.getAttribute('data-lazy-src') ||
      img.getAttribute('src')
    );
    if (!src) return;
    blocks.push({ type: 'image', url: src, alt: clean(img.getAttribute('alt')) });
  };

  const stripUnsafeAttributes = (node) => {
    const urlAttributes = ['href', 'src', 'xlink:href', 'action', 'formaction'];
    Array.from(node.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const unsafe =
        name.startsWith('on') ||
        name === 'srcdoc' ||
        (urlAttributes.includes(name) && /^\s*javascript:/i.test(attribute.value));
      if (!unsafe) return;
      node.removeAttribute(attribute.name);
      strippedAttributeCount += 1;
    });
  };

  const sanitizeTable = (table) => {
    const clone = table.cloneNode(true);
    const originalDescendants = Array.from(table.querySelectorAll('*'));
    const clonedDescendants = Array.from(clone.querySelectorAll('*'));
    stripUnsafeAttributes(clone);
    originalDescendants.forEach((original, index) => {
      markSeen(original);
      const reason = hiddenReason(original);
      const cloned = clonedDescendants[index];
      if (reason) {
        recordExclusion(reason);
        cloned?.remove();
        return;
      }
      if (cloned) stripUnsafeAttributes(cloned);
    });
    return clone.outerHTML;
  };

  for (const node of candidateNodes) {
    if (hasSeen(node)) continue;
    const reason = hiddenReason(node);
    if (reason) {
      recordExclusion(reason);
      continue;
    }
    markSeen(node);
    const tag = node.tagName.toLowerCase();
    if (tag === 'img') {
      pushImage(node);
      continue;
    }
    if (tag === 'figure') {
      const img = node.querySelector('img');
      if (img) {
        markSeen(img);
        const imageReason = hiddenReason(img);
        if (imageReason) recordExclusion(imageReason);
        else pushImage(img);
      }
      const caption = clean(node.querySelector('figcaption')?.innerText);
      if (caption) blocks.push({ type: 'text', tag: 'figcaption', text: caption, links: [] });
      continue;
    }
    if (tag === 'table') {
      blocks.push({ type: 'table', html: sanitizeTable(node) });
      continue;
    }
    const text = tag === 'pre' ? node.innerText.trim() : clean(node.innerText);
    if (!text) continue;
    const links = [...node.querySelectorAll('a')]
      .map((a) => ({ text: clean(a.innerText), href: absoluteUrl(a.href) }))
      .filter((link) => link.text && link.href && !link.href.startsWith('javascript:'));
    blocks.push({ type: 'text', tag, text, links });
  }

  const textCharacters = blocks
    .filter((block) => block.type === 'text')
    .reduce((sum, block) => sum + block.text.length, 0);

  return {
    url: canonicalUrl,
    observedUrl: location.href,
    title: titleMetadata.value.replace(/\s*[-–—|]\s*(今日头条|微信公众号|知乎|百家号|网易新闻|搜狐|新浪财经|腾讯新闻|36氪|虎嗅|澎湃新闻)\s*$/, ''),
    author: authorMetadata.value,
    publishTime: publishTimeMetadata.value,
    metadata: {
      titleSource: titleMetadata.source,
      authorSource: authorMetadata.source,
      publishTimeSource: publishTimeMetadata.source
    },
    blocks,
    metrics: {
      textCharacters,
      images: blocks.filter((block) => block.type === 'image').length,
      tables: blocks.filter((block) => block.type === 'table').length
    },
    sanitization: {
      contentTrust: 'untrusted_web_content',
      excludedNodeCount,
      excludedReasons,
      strippedAttributeCount
    }
  };
})();
