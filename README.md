# Article-Skill-Evaluator — 文章读取、深度解读、工具评估与内容增强

> 版本：v2.6.0（2026-10-13）

一个面向 AI Agent 的**文章读取与 Skill／工具评价 Skill**：读取粘贴文字/本地文本/网页/PDF/飞书文档 → 深度解读 → 核实真实性、安全性、Skill九维质量与实际行为 → 结合使用者需求判断工具是否能装、值得装 → 将文章加工为播客/Quiz/闪卡。

面向能够读取 `SKILL.md` 和包内相对路径文件的 Agent 环境。自动发现、浏览器控制、TTS、文件写入和外部扫描能力取决于具体宿主，需在当前环境实测，不能由安装说明推定。

---

## 名称与能力整合

原 `article-reader` 从 v2.6.0 起统一更名为 **Article-Skill-Evaluator**，Skill 标识与安装目录为 `article-skill-evaluator`。保留原有读取、深度解读和内容增强能力，并内置通用 `skill-evaluator` 的九维评价口径；明确要求优化时执行单轮单维、备份、diff、验证和回滚闭环。独立 `skill-evaluator` 仍可单独使用；外部 `skill-test` 和扫描器未捆绑进本包。

普通“读一下”先给简报与必要核验；“评价这个工具／能不能装／值不值得装”展开源码、安全、九维、行为测试及用户价值流程。对于没有 SKILL.md 的 CLI/MCP，评估实现和实际行为，不编造 Skill 九维分数。

旧版迁移：先备份旧目录，再将新版放入同级 `article-skill-evaluator/`。若已有规则引用旧名，可将旧 `article-reader/SKILL.md` 改成兼容入口，指向 `../article-skill-evaluator/SKILL.md`；旧名不作为第二套维护来源。已有脚本调用所用的 `read-article.cjs`、`read-article-playwright.py` 文件名及 `ARTICLE_READER_*` 环境变量保持兼容。

## 验证范围

v2.5.1 已实测：Python Playwright 浏览器行为22项、长页5项、读取路线29项；微信默认命令10次滚动稳定到底。v2.6.0 是统一更名与介绍更新，发布前重跑受影响测试，结果见对应 Release。DOM到底不替代图片、分页核验；没有承诺所有网站可读、自动解验证码或所有宿主模型调用均已验收。

## ✨ 功能特性

### 1. 读取模式（默认）
- 统一入口 `node scripts/read-article.cjs --url "<url>"`：HTTP 受阻时自动执行适用的 Python/Node Playwright 路线；默认 stdout，取证显式 `--out`，拒绝意外覆盖。
- 只读抓取网页、微信公众号、今日头条、知乎、PDF、飞书文档等
- 输出三段简报：文章讲什么 / 主要观点 / 初步可信度
- 动态站点可在当前环境已安装 Playwright 时走临时浏览器路线；真实可读性按目标页面逐次验证
- 动态长页每8次自动同页接续，默认整次60次/30秒，到底或无法进展时停止，并返回正文增量、停止原因与完整性；`PASS` 表示取得可分析正文，不承诺图片、分页和虚拟列表全部读完
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
- Skill内置通用九维质量评价；实际测试优先接入可用的 skill-test，缺失时用隔离测试契约，未执行明确标为未验证
- 分开回答真实性、安全性、安装条件与用户价值，给具体应用场景和验收指标；关键安全问题或实测失败否决安装
- 先给统一决策报告，安装须有明确授权；外部扫描器和测试运行器不是本包自带依赖

### 4. 增强模式
- **文章转播客**：结构化口播稿 → 探测宿主真实 TTS；不可用则明确交付稿件，音频仅写指定目录
- **Quiz / 闪卡生成**：提取知识点，并用确定性脚本生成 Markdown、离线 HTML 或 Anki CSV
- **付费内容读取**：只使用用户已有授权会话、用户导出文件、机构许可渠道或发布方公开替代版本，不绕过访问控制

---

## 📦 安装

### 方式 A：复制目录（推荐）
1. 从 [Releases](https://github.com/quziwen/Article-Skill-Evaluator/releases) 下载发布包，解压得到 `article-skill-evaluator` 文件夹；使用 GitHub 源码 ZIP 时，将包含 SKILL.md 的根目录命名为 `article-skill-evaluator`
2. 复制到目标 Agent 的技能目录：

| 环境 | 安装路径 |
|------|---------|
| Claude Code | `~/.claude/skills/article-skill-evaluator/` |
| Codex | `~/.codex/skills/article-skill-evaluator/` |
| Hermes | `<HERMES_HOME>/skills/article-skill-evaluator/`；Windows Studio 默认 `%LOCALAPPDATA%/hermes/skills/`，其他环境以实际 Home 为准 |
| DewuClaw | 当前工作区的 `skills/article-skill-evaluator/`；某些桌面版本使用 `~/.dewuclaw/workspaces/<workspace>/skills/`，以原生列表/API 为准 |
| DeepSeek Harness（DSH） | `~/.dsh/skills/article-skill-evaluator/`；共享来源可用 `~/.agents/skills/`，注意同名 Skill 的加载优先级 |
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
分析这篇文章 <链接>                    → 深度模式：默认标准级别（含批判性与逆向思维）
用第一性原理分析 <内容/链接>           → 深度模式：指定框架
这个 skill 值不值得装 <链接>           → 评估模式：装不装决策报告
帮我看看这个 skill/插件 <链接>         → 评估模式
把这篇文章做成播客 <链接>              → 增强模式：口播稿；TTS 可用且路径明确时生成音频
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
python -B scripts/test-long-page-completion.py
python scripts/test-playwright-policy.py
node scripts/test-quiz-renderer.mjs
```

---

## 📁 目录结构

```
article-skill-evaluator/
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
│   ├── evaluation/               # 评估模式（含九维、测试与用户价值）
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


