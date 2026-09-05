# 浏览器执行路线

仅用于专用连接器、API 或 CLI 不存在、不可用，或明确需要动态可见 DOM 的微信、头条、知乎等页面。目标是取得用户可见 DOM，不是绕过站点控制。

## 启动前门槛

1. 先查询当前会话可用的专用连接器、API 或 CLI。
2. 本 Skill 执行器存在时先运行 `node scripts/read-article.cjs --preflight`；可用则先走非 Browser 路线。
3. 只有前述路线不能覆盖当前操作时，才初始化 Browser/Chrome。
4. Browser 若返回平台或宿主安全策略拒绝，将结果分类为 `HOST_BROWSER_POLICY` 并停止；不得改用 raw CDP、其他浏览器表面或间接脚本实现同一结果。

## Codex 桌面

1. 确认已完成“启动前门槛”，再搜索当前可调用的 Browser/Chrome 控制工具与 Node REPL。
2. 读取已安装 Browser 或 Chrome Skill 的完整 `SKILL.md`，按其当前版本初始化运行时；不要硬编码插件缓存版本路径。
3. 连接浏览器后调用完整 `browser.documentation()`，再执行页面动作。
4. 新建或认领一个用户明确授权的标签页，调用 `tab.goto(url)`。
5. 等待 `domcontentloaded`，获取一次 DOM snapshot，确认当前页不是登录墙、验证码或 App 壳。
6. 只在可见 DOM 中点击精确匹配的“展开全文”“阅读全文”“Show more”控件；不填写表单、不提交、不下载。
7. 分段滚动以触发懒加载，回到顶部后，用一次有界的只读 `tab.playwright.evaluate(...)` 执行 `scripts/extract-visible-article.js`。
8. 检查返回的 `title`、`metrics.textCharacters`、`blocks` 和 `sanitization`。微信优先确认 `#js_content`，头条允许一次导航竞争重试。
9. 读取完成后关闭新建标签；认领的用户标签页保持原状。

## 独立 Playwright

在 Node 和受信任 Playwright 已可用时运行：

```text
node scripts/read-article.cjs --url "<url>" --mode browser
```

脚本按 `chrome -> msedge -> bundled chromium` 顺序尝试浏览器，只输出 JSON。找不到 Playwright 时设置：

```text
ARTICLE_READER_PLAYWRIGHT_ROOT=<trusted-project-root>
```

不得让脚本自动执行 `npm install`、下载浏览器、复用个人 profile 或写入文章文件。

## 成功判定

- `status` 为 `PASS`。
- 标题非空，正文不是导航、登录或验证提示。
- `metrics.textCharacters` 对文章通常不少于 300；短帖可以低于 300，但必须有可解释的正文或图片。
- `sanitization.contentTrust` 为 `untrusted_web_content`。
- 隐藏节点、脚本、事件处理器和 `javascript:` URL 未进入结果。

## 失败判定

将真实结果映射为 `LOGIN_WALL`、`PAYWALL`、`CAPTCHA`、`PERMISSION_DENIED`、`ANTI_BOT`、`TOOL_MISSING`、`NETWORK_ERROR`、`EMPTY_OR_SHELL_PAGE`、`UNSUPPORTED_FORMAT` 或 `HOST_BROWSER_POLICY`。报告已调用的路线和证据，不要写成泛化的“无法联网”。
