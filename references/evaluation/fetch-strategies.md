# 抓取策略：拿到链接正文

步骤 0 用。目标是稳定拿到链接里的真实内容，尤其是 GitHub 仓库的关键文件和被付费墙挡住的文章。

---

## 第一步永远是：清洗 URL

分享链接常带巨长的跟踪参数，导致抓取工具报「URL 过长」直接失败。先砍掉问号后的一切：

```bash
CLEAN="${URL%%\?*}"   # 去掉 ? 及其后所有 query 参数
echo "$CLEAN"
```

例：`.../article/7646215395946299914/?app=...&share_token=...&utm_source=feishu`
→ `.../article/7646215395946299914/`。短了，也更易抓。

---

## 第二步：壳链接要穿透到底层项目

内容聚合平台的文章是「导读壳」，不是可安装物。识别清单：
`toutiao.com`、`mp.weixin.qq.com`（微信公众号）、`zhihu.com`、`juejin.cn`、`csdn.net`、
`jianshu.com`、`medium.com`、`substack.com`、各类个人博客。

抓到壳正文后，从中提取它真正介绍的 **GitHub 仓库 / 官网**，把评估对象切换过去。
正文里找不到链接时，用工具名 + "github" 去搜官方仓库。

---

## 中文聚合平台反爬较强

`toutiao.com` / `mp.weixin.qq.com` 直连常被拒。优先级调整为：
**存档层（web.archive.org）和代理层（markdown.new）往往比直连更有效**，可以提到前面试。
微信公众号文章若 `mp.weixin.qq.com/s/<id>` 直连失败，存档层通常能命中。

---

## GitHub / Gist 优先抓这些文件

类型判定的证据几乎都在这几个文件里，按顺序抓，抓到能定性就停：

```bash
RAW="https://raw.githubusercontent.com/<owner>/<repo>/<branch>"   # branch 通常是 main 或 master
curl -sL "$RAW/README.md"
curl -sL "$RAW/SKILL.md"
curl -sL "$RAW/plugin.json"
curl -sL "$RAW/.claude-plugin/marketplace.json"
curl -sL "$RAW/package.json"
curl -sL "$RAW/.mcp.json"
```
- 分支不确定时，先 WebFetch 仓库主页看默认分支，或两个都试。
- 看 `package.json` 的 `dependencies` 能判断是否依赖 `@modelcontextprotocol/*`（→ MCP）。

---

## 付费墙 / 抓不到正文：6 层降级

按优先级逐层尝试，前一层失败再下一层（改编自用户的 Content Enhancer 文档）。
仅用于个人学习评估，遵守网站 ToS。

```
第1层  代理读取    curl -sL "https://markdown.new/<URL>"
第2层  Googlebot   curl -sL "<URL>" -H "User-Agent: Googlebot/2.1 (+http://www.google.com/bot.html)"
第3层  AMP 版本    在 URL 后加 /amp 或 ?amp
第4层  网页存档    https://web.archive.org/web/*/<URL>
第5层  Google缓存  https://webcache.googleusercontent.com/search?q=cache:<URL>
第6层  Playwright  无头浏览器渲染（需 pip install playwright && playwright install chromium）
```

第 6 层模板：
```python
import asyncio
from playwright.async_api import async_playwright
async def fetch(url):
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        pg = await b.new_page()
        await pg.goto(url, wait_until='networkidle')
        print((await pg.inner_text('body'))[:8000])
        await b.close()
asyncio.run(fetch('<URL>'))
```

---

## 抓不到怎么办

逐层都失败时，**不要编评估**。如实说明：「这个链接抓不到正文（付费墙/反爬/需要登录）」，
并请用户把关键内容（README / 安装说明）贴过来，或换一个可访问的镜像 / 原始仓库地址。
