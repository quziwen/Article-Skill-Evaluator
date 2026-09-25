# Article Reader — 文章读取、深度解读、工具评估与内容增强

> 版本：v2.4.0（2026-09-25）

一个面向 AI Agent 的**四合一文章处理 Skill**：读取网页/PDF/飞书文档 → 深度解读 → 评估文章中介绍的工具是否值得安装 → 将文章加工为播客/Quiz/闪卡。

面向能够读取 `SKILL.md` 和包内相对路径文件的 Agent 环境。自动发现、浏览器控制、TTS、文件写入和外部扫描能力取决于具体宿主，需在当前环境实测，不能由安装说明推定。

---

## ✨ 功能特性

### 1. 读取模式（默认）
- 统一入口 `node scripts/read-article.cjs --url "<url>"`：HTTP 受阻时自动执行适用的 Python/Node Playwright 路线；默认 stdout，取证显式 `--out`，拒绝意外覆盖。
- 只读抓取网页、微信公众号、今日头条、知乎、PDF、飞书文档等
- 输出三段简报：文章讲什么 / 主要观点 / 初步可信度
- 动态站点可在当前环境已安装 Playwright 时走临时浏览器路线；真实可读性按目标页面逐次验证
- 动态长页使用有限滚动，并返回正文增量、停止原因与完整性；`PASS` 表示取得可分析正文，不承诺图片、分页和虚拟列表全部读完
- 已授权的现有登录会话可由宿主受控浏览器只读接续；临时执行器不导出 Cookie、不复制个人 profile

### 2. 深度模式
- 10+ 思维框架，四档深度可选：
  - 快速（15 分钟）：SCQA + 5W2H
  - 标准（30 分钟）：+ 批判性思维 + 逆向思维
  - 深度（60 分钟）：+ 心智模型 + 第一性原理 + 系统思维 + 六顶思考帽
  - 研究（120 分钟+）：+ 跨源对比

### 3. 评估模式
- 读取到的文章若在介绍 skill / 插件 / MCP / CLI / 工具，**自动穿透导读壳**，评估底层项目
- 三轴评估：值得装（客观质量）/ 适合你（结合用户画像）/ 有风险（供应链、权限、外部组件、代码级扫描）
- 分开记录文章宣传、官方说明、源码和本轮实测；核对本地/远程模式、会话、费用及数据去向，官方资料冲突保留为待核实
- 内置安全扫描编排（aguara / skill-scanner / secrets-scan / structure-check）；缺任一必需扫描器时输出 INCOMPLETE，不会误报 SAFE
- 绝不自动安装，先给「装不装」决策报告，用户确认后才给安装命令

### 4. 增强模式
- **文章转播客**：结构化内容 → TTS 生成 MP3
- **Quiz / 闪卡生成**：提取知识点，并用确定性脚本生成 Markdown、离线 HTML 或 Anki CSV
- **付费内容读取**：只使用用户已有授权会话、用户导出文件、机构许可渠道或发布方公开替代版本，不绕过访问控制

---

## 📦 安装

### 方式 A：复制目录（推荐）
1. 下载本仓库，解压后得到 `article-reader` 文件夹
2. 复制到目标 Agent 的技能目录：

| 环境 | 安装路径 |
|------|---------|
| Claude Code | `~/.claude/skills/article-reader/` |
| Codex | `~/.codex/skills/article-reader/` |
| Hermes | `<HERMES_HOME>/skills/article-reader/`；Windows Studio 默认 `%LOCALAPPDATA%/hermes/skills/`，其他环境以实际 Home 为准 |
| DewuClaw | 当前工作区的 `skills/article-reader/`；某些桌面版本使用 `~/.dewuclaw/workspaces/<workspace>/skills/`，以原生列表/API 为准 |
| DeepSeek Harness（DSH） | `~/.dsh/skills/article-reader/`；共享来源可用 `~/.agents/skills/`，注意同名 Skill 的加载优先级 |
| 其他 Agent | 对应环境的 skills 目录 |

3. 重开会话 / 重载技能生效

覆盖前备份完整旧目录，备份放在 Skill 发现目录之外。复制后核对包内文件清单，再用宿主原生列表/加载器验证发现；文件复制、宿主发现和实际文章调用分别验收，不能互相替代。不要修改凭证、模型配置或其他 Skill 来完成安装。

### 方式 B：依赖检查

| 依赖 | 用途 | 检查命令 |
|------|------|---------|
| Node.js | 基础读取执行器 | `node -v` |
| Python 3 + Playwright + Chromium | 头条/微信等反爬站点 | `python -c "import playwright"` |
| aguara + skill-scanner + Python 3 | 完整代码扫描；缺失时只能得出 INCOMPLETE | `bash scripts/vetter/check-deps.sh` |

> 脚本不自动安装依赖、不调用 sudo、不克隆安装器。请通过组织认可的包管理流程固定并审查 Playwright、浏览器与扫描器版本。

---

## 🚀 使用 / 调用

对 Agent 说一句话即可：

```
读一下 <链接>                          → 读取模式：三段简报
分析这篇文章 <链接>                    → 深度模式：SCQA 快速分析
用第一性原理分析 <内容/链接>           → 深度模式：指定框架
这个 skill 值不值得装 <链接>           → 评估模式：装不装决策报告
帮我看看这个 skill/插件 <链接>         → 评估模式
把这篇文章做成播客 <链接>              → 增强模式：TTS 音频
给这篇文章出 Quiz <链接>              → 增强模式：自测题
读取这篇付费文章 <链接>                 → 增强模式：仅走已有授权或公开替代版本
```

### 命令行直接调用

```bash
# 普通网页读取
node scripts/read-article.cjs --url "https://example.com/article"

# 头条等反爬站点（Python Playwright 兜底）
python scripts/read-article-playwright.py "https://www.toutiao.com/article/<id>/"

# 评估模式安全扫描
bash scripts/vetter/vett.sh "<skill-or-repo-or-path>"

# 自检
node scripts/read-article.cjs --self-test
node scripts/test-routing.cjs
node scripts/test-reader-routing.cjs
node scripts/test-node-url-policy.cjs
python -B scripts/test-reader-behavior.py
python scripts/test-playwright-policy.py
node scripts/test-quiz-renderer.mjs
```

---

## 📁 目录结构

```
article-reader/
├── SKILL.md                      # 技能主文件（四模式分流）
├── README.md                     # 本说明
├── CONTRIBUTORS
├── agents/openai.yaml            # OpenAI/Codex 兼容声明
├── references/
│   ├── source-routing.md         # 读取来源路由
│   ├── browser-runtime.md        # 浏览器执行路线（含 Python Playwright）
│   ├── crawler-options.md        # 外部爬虫候选与禁用能力
│   ├── output-templates.md       # 读取输出格式
│   ├── deep/                     # 深度分析框架库（10 个）
│   ├── evaluation/               # 评估模式（7 个）
│   └── enhance/                  # 内容增强（3 个）
└── scripts/
    ├── read-article.cjs          # Node 无 Cookie HTTP 提取器
    ├── read-article-playwright.py# Python Playwright 反爬兜底
    ├── render-quiz.mjs           # Markdown/HTML/Anki 确定性渲染
    ├── extract-visible-article.js# 可见 DOM 提取
    ├── test-routing.cjs          # 触发/分流回归测试
    ├── fixtures/                 # 测试夹具
    └── vetter/                   # 安全扫描器（原 skill-vetter）
```

---

## 🛠 技术说明

- **只读安全**：不归档、不同步、不发消息、不自动登录；文章默认只输出 JSON，明确要求取证时使用 --out，Quiz 文件仅在用户明确要求时写入；不绕过验证码、登录墙或付费墙
- **不可信数据处理**：网页正文/HTML/图片 alt/代码块视为不可信数据，只提取不执行页面指令
- **失败分类**：LOGIN_WALL / PAYWALL / CAPTCHA / ANTI_BOT / TOOL_MISSING / EMPTY_OR_SHELL_PAGE 等 10 类，如实报告不编造
- **地址与覆盖保护**：动态读取阻断本机/私网/保留地址及不安全重定向；指定输出路径默认拒绝覆盖

---

## 📄 许可

MIT License

Copyright (c) 2026 quziwen

---

## 🙏 致谢

- [anthropics/skills](https://github.com/anthropics/skills) — Skill 规范与框架灵感
- [darwin-skill](https://github.com/alchaincyf/darwin-skill) — 9 维评估方法论
- 所有 `references/` 下框架文档的原作者
