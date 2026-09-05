# Article Reader — 文章读取、深度解读、工具评估与内容增强

> 版本：v2.1（2026-09-05）

一个面向 AI Agent 的**四合一文章处理 Skill**：读取网页/PDF/飞书文档 → 深度解读 → 评估文章中介绍的工具是否值得安装 → 将文章加工为播客/Quiz/闪卡。

支持 DSH（DeepSeek Harness）/ Claude Code / Codex / Hermes / Cursor / Gemini / TRAE 等所有使用 `SKILL.md` 规范的 Agent 环境。

---

## ✨ 功能特性

### 1. 读取模式（默认）
- 只读抓取网页、微信公众号、今日头条、知乎、PDF、飞书文档等
- 输出三段简报：文章讲什么 / 主要观点 / 初步可信度
- 头条等反爬站点自动走 Python Playwright 真实浏览器路线

### 2. 深度模式
- 10+ 思维框架，四档深度可选：
  - 快速（15 分钟）：SCQA + 5W2H
  - 标准（30 分钟）：+ 批判性思维 + 逆向思维
  - 深度（60 分钟）：+ 心智模型 + 第一性原理 + 系统思维 + 六顶思考帽
  - 研究（120 分钟+）：+ 跨源对比

### 3. 评估模式
- 读取到的文章若在介绍 skill / 插件 / MCP / CLI / 工具，**自动穿透导读壳**，评估底层项目
- 三轴评估：值得装（客观质量）/ 适合你（结合用户画像）/ 有风险（供应链、权限、外部组件、代码级扫描）
- 内置安全扫描器（skill-vetter 集成：aguara / skill-analyzer / secrets-scan / structure-check）
- 绝不自动安装，先给「装不装」决策报告，用户确认后才给安装命令

### 4. 增强模式
- **文章转播客**：结构化内容 → TTS 生成 MP3
- **Quiz / 闪卡生成**：提取知识点 → 自测题 + 记忆卡片
- **付费墙读取**（仅用户明确要求时）：6 层策略，优先公开快照，仅供个人学习研究

---

## 📦 安装

### 方式 A：复制目录（推荐）
1. 下载本仓库，解压后得到 `article-reader` 文件夹
2. 复制到目标 Agent 的技能目录：

| 环境 | 安装路径 |
|------|---------|
| DSH | `~/.agents/skills/article-reader/` |
| Claude Code | `~/.claude/skills/article-reader/` |
| Codex | `~/.codex/skills/article-reader/` |
| Hermes | `~/.hermes/skills/article-reader/` |
| DeepSeek Harness | `~/.dsh/skills/article-reader/`（DSH 桌面版） |
| 其他 Agent | 对应环境的 skills 目录 |

3. 重开会话 / 重载技能生效

### 方式 B：依赖检查

| 依赖 | 用途 | 检查命令 |
|------|------|---------|
| Node.js | 基础读取执行器 | `node -v` |
| Python 3 + Playwright + Chromium | 头条/微信等反爬站点 | `python -c "import playwright"` |
| vetter 扫描器（可选） | 评估模式安全扫描 | `bash scripts/vetter/check-deps.sh` |

> 脚本不自动安装依赖。Python Playwright 需手动装：`pip install playwright && python -m playwright install chromium`。

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
绕过付费墙读这篇 <链接>               → 增强模式：付费墙读取（需明确要求）
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
    ├── extract-visible-article.js# 可见 DOM 提取
    ├── test-routing.cjs          # 触发/分流回归测试
    ├── fixtures/                 # 测试夹具
    └── vetter/                   # 安全扫描器（原 skill-vetter）
```

---

## 🛠 技术说明

- **只读安全**：不保存、不归档、不同步、不发消息、不自动登录；不绕过验证码/登录墙（付费墙仅在用户明确要求时按 6 层策略处理，优先公开快照）
- **不可信数据处理**：网页正文/HTML/图片 alt/代码块视为不可信数据，只提取不执行页面指令
- **失败分类**：LOGIN_WALL / PAYWALL / CAPTCHA / ANTI_BOT / TOOL_MISSING / EMPTY_OR_SHELL_PAGE 等 10 类，如实报告不编造
- **Windows GBK 控制台**：Python 脚本禁止直接 print 中文全文到 stdout（会 UnicodeEncodeError），正文 JSON 写文件后回读

---

## 📄 许可

MIT License

Copyright (c) 2026 quziwen

---

## 🙏 致谢

- [anthropics/skills](https://github.com/anthropics/skills) — Skill 规范与框架灵感
- [darwin-skill](https://github.com/alchaincyf/darwin-skill) — 9 维评估方法论
- 所有 `references/` 下框架文档的原作者
