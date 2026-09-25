# 来源路由

先按来源选择工具。`read-article.cjs --url` 默认先 HTTP，再执行至多一次适用的本地浏览器读取（Python Playwright 优先，Node Playwright 次之）。`--mode http` 只诊断。HTTP 初判与浏览器实际阻断分开记录；真实验证、登录、付费、权限或宿主拒绝不自动处理。

| 来源 | 识别信号 | 首选路线 | 适用备选 | 停止条件 |
|---|---|---|---|---|
| 标准文章或博客 | 普通 `https://` 页面 | 网页打开/正文提取；或 `read-article.cjs` | 已安装的 Defuddle；真实浏览器 DOM | 空标题、正文只有导航或错误页 |
| 微信公众号 | `mp.weixin.qq.com/s` | 专用只读连接器/API/CLI；或 `read-article.cjs` 的无 Cookie HTTP 提取，确认 `#js_content` | HTTP 反爬、空壳或验证码初判后，自动用已安装 Playwright 正常打开原始链接；必要时用户提供正文 | 浏览器确认真实验证码/登录/权限、空正文或 `HOST_BROWSER_POLICY` |
| 今日头条 | `toutiao.com/article/`、`m.toutiao.com/group/`、`toutiao.com/w/` | 专用只读连接器/API/CLI；或 `read-article.cjs` 的无 Cookie HTTP 提取 | HTTP 反爬或 App 壳后自动用已安装 Playwright 读取；正规搜索定位同一公开文章 | 浏览器确认真实验证码/权限、空正文或 `HOST_BROWSER_POLICY`；仅含 byted_acrawler 标记不代表正文不可读 |
| 知乎 | `zhuanlan.zhihu.com/p/`、`zhihu.com/question/` | 真实浏览器可见页面 | 用户提供导出或粘贴正文 | `40362`、登录墙、验证码 |
| CSDN/掘金/Medium | 文章路径 | 网页正文提取 | 真实浏览器 DOM | 付费墙、登录墙、正文被折叠且无法展开 |
| GitHub 文档 | `github.com`、`raw.githubusercontent.com` | 官方仓库文件或 raw 内容 | 官方发布页 | 仓库私有或权限不足 |
| PDF | URL 以 `.pdf` 结尾或响应为 PDF | PDF 读取工具 | 浏览器 PDF 文本层 | 扫描件无 OCR 且现有工具不支持 |
| 飞书/Lark 文档 | `/docx/`、`/wiki/` 或文档 token | 飞书文档连接器/CLI 只读获取 | 用户导出 PDF/Word 或提供公开链接 | 权限不足、token 无效、登录未授权 |
| 裸文本/本地文件 | 用户粘贴正文或给出本地路径 | 直接读取 | 对应文档工具 | 文件不存在或格式不支持 |

## 快速识别无效正文

出现以下信号时，不把页面当作正文：

- 页面只有验证提示而没有正文。`captcha`、`verify`、`byted_acrawler`、`__ac_signature` 只是线索，不能单独据此否定可见连续正文。
- “请登录”“访问验证”“打开 App 查看全文”“订阅后继续阅读”。
- 文本很长但主要是菜单、版权、推荐列表、脚本或样式。
- 标题为空，正文与链接主题明显无关，或只能取到全页导航而未定位正文。
- 搜索结果摘要代替了原文内容。

## 访问边界

- 只读取用户本来有权访问的内容。
- 语义读取链接时，先查询专用连接器、API 或 CLI；存在适用路线时不要先启动 Browser。
- 不自动登录、不绕过验证、不修改浏览器或账号安全配置。
- 如果当前浏览器已有用户主动建立且授权使用的会话，可在只读范围内使用；否则先说明需要用户自行完成登录。
- 临时 Playwright 没有登录态不代表用户现有受控会话也无权限。按既有授权选择会话，不导出 Cookie、不复制 profile，不把登录状态复用称为“免登录”。
- 长页读取必须核对正文增量、停止原因和完整性；达到次数/时间上限则限定结论。禁止把推荐列表和无限滚动信息流拼成同一篇全文。
- 不把 Scrapling stealth、Cloudflare solver、代理轮换、Firecrawl actions 或任何验证码绕过能力接入默认阅读路线。
- 不向云端抓取服务发送内网链接、带临时签名的私有链接、账号 Cookie、Authorization 请求头或个人敏感信息。
- 本地执行器在导航前、子资源请求和最终重定向后都必须拒绝内嵌凭证、localhost、私网、链路本地和保留地址；DNS 解析失败或混入非公网地址时停止，不降级绕行。
- Browser 返回平台安全策略拒绝后，停止该 URL 的浏览器及间接执行路线，不用其他控制面或脚本规避。
