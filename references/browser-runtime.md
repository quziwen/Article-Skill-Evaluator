# 浏览器执行路线

公开文章的默认入口是 `node scripts/read-article.cjs --url "<url>"`，其顺序为公开 HTTP → 一次适用的临时浏览器读取。先查询适用的专用只读连接器、API 或 CLI；已有适用路线时不先打开桌面浏览器。

## 自动路线

1. `--preflight` 分别检查 Python Playwright 和 Node Playwright；可导入/浏览器文件存在只是预检，不能冒充启动成功。
2. 默认 auto 在 HTTP 反爬、空壳、网络失败或验证码初判时，先使用 Python Playwright；不可用时才使用 Node Playwright。只正常加载原始公开 URL，不打开或操作挑战地址，不复用个人 profile。
3. Python 默认从 PATH 查找，也支持 `ARTICLE_READER_PYTHON` 指向已有受信任解释器；Node 可用 `ARTICLE_READER_PLAYWRIGHT_ROOT` 指向已有受信任项目。不自动安装包或下载浏览器。
4. 浏览器确认真实验证码、登录、付费、权限控制后，停止对应操作并报告。用户已有授权会话、导出正文或发布方公开版本可作为接续输入；不自动处理登录或验证。
5. Browser 返回 `HOST_BROWSER_POLICY` 后停止该 URL 的浏览器及间接绕行，不再改用脚本、raw CDP 或其他浏览器表面。

## 命令与输出

```text
node scripts/read-article.cjs --preflight
node scripts/read-article.cjs --url "<url>"
node scripts/read-article.cjs --url "<url>" --mode http
node scripts/read-article.cjs --url "<url>" --out "<已存在目录/结果.json>"
python scripts/read-article-playwright.py "<url>" --out "<已存在目录/结果.json>"
```

默认完整 JSON 仅输出到 stdout。`--out` 才创建文件，必须指定约定目录；默认拒绝覆盖。不要为读取普通文章创建知识库副本。结果中的 `attempts` 区分 HTTP、浏览器预检和实际浏览器读取，不把缺工具写成站点拒绝。

## Codex 桌面浏览器

两种本地执行器都不可用，或明确需要用户交互时，再读取当前浏览器工具/Skill 返回的完整使用说明并按其 API 初始化；不要套用旧版本的 API 名称。新建临时标签，读取 DOM，按需要使用 `scripts/extract-visible-article.js`。仅在页面允许时展开正文，不提交表单或处理验证码。完成后关闭新建标签，保持用户原有标签不变。

## 成功与失败判定

- 标题、正文主题与来源一致；取得一个有效正文容器中的连续可见文字。微信优先 `#js_content`，父子容器和嵌套段落不重复计数。
- 分开报告页面文本量、正文字符数和正文段落数。不得静默截断正文后仍声称读完。
- 正文外的验证组件可记警示；真实验证页、登录提示、权限页或遮挡正文的验证弹窗不能判 PASS。
- 失败保留 `CAPTCHA`、`LOGIN_WALL`、`PAYWALL`、`PERMISSION_DENIED`、`ANTI_BOT`、`TOOL_MISSING`、`NETWORK_ERROR`、`EMPTY_OR_SHELL_PAGE`、`HOST_BROWSER_POLICY` 等实际原因，不笼统说无法联网。
- `--self-test` 在当前可用的浏览器运行真实 DOM 夹具，并执行分类反例；浏览器未运行时总结果为 PARTIAL。真实网站仍需另行读取核验。
