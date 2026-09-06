# Claude Code 扩展类型：识别 / 安装 / 查重

这份文档是步骤 1（识别类型）、步骤 2（安装方式）、步骤 3（查重）的事实依据。
Claude Code 的扩展点就这么几类，先认准类型，后面一切判断都顺。

> 术语提醒：Plugin 是「分发单位」，里面可以打包 Skill + MCP + 命令 + hook + subagent。
> 也就是说——**你装的是 plugin，用的是里面的 skill**。一个 GitHub 仓库可能同时是「一个 plugin 市场」。

---

## 1. Skill

**识别信号**
- 仓库里有 `SKILL.md`，开头是 YAML frontmatter，至少含 `name` 和 `description`。
- 可能还有 `scripts/`、`references/`、`assets/` 子目录。
- 可能出现 Claude Code 专属 frontmatter 字段：`context: fork`、`allowed-tools`、`hooks`——这些是「原生 Claude Code skill」的强信号。

**适配判断**
- 标准 SKILL.md 格式 = Agent Skills 开放标准，Claude Code 原生支持，✅ 直接适配。
- 即便它写着「for Cursor / Codex / Gemini」，只要是标准 SKILL.md，Claude Code 也能用（专属字段会被安全忽略）。

**安装方式**
```bash
# 个人级（所有项目可用）
mkdir -p ~/.claude/skills/<skill-name>
# 把 SKILL.md 及其 scripts/references/assets 一并放进该目录

# 项目级（只在当前仓库、可随 git 共享）
mkdir -p .claude/skills/<skill-name>
```
- 从 GitHub 装：`git clone` 后把对应子目录 `cp -r` 到上面的位置。
- 装完开新会话即生效。临时停用：把目录改名加下划线前缀 `_<skill-name>`。

---

## 2. Plugin

**识别信号**
- 有 `.claude-plugin/` 目录或 `plugin.json` / `marketplace.json`。
- README 自称 "plugin"、"marketplace"，给出 `/plugin marketplace add ...` 之类命令。
- 内容是「一堆 skill/命令/MCP 的合集」。

**适配判断**：✅ 原生。Plugin 就是 Claude Code 的「应用商店」分发格式。

**安装方式**
```bash
# 1) 先把它的市场（GitHub 仓库）加进来
/plugin marketplace add <owner>/<repo>        # GitHub 简写
/plugin marketplace add https://...git        # 任意 git URL

# 2) 再安装其中的某个 plugin
/plugin install <plugin-name>@<marketplace-name>
# 或命令行：claude plugin install <plugin-name>@<marketplace>
```
- 官方市场 `claude-plugins-official` 默认就在，无需手动添加。
- 安装时可选 user scope（全局）或 project scope（装到 `.claude/`，随仓库共享）。

---

## 3. MCP Server

**识别信号**
- 提到 `claude mcp add`、Model Context Protocol、`@modelcontextprotocol/...`。
- 说明里区分 transport：`stdio`（本地进程）/ `SSE` / `HTTP`（远程）。
- 强调「连接到外部服务 / API / 数据源」（GitHub、数据库、浏览器等）。

**适配判断**：✅ 原生。但注意远程 MCP 常需 API key、账号、联网——计入「成本/安全」。

**安装方式**
```bash
# 本地（启动一个本地进程）
claude mcp add <name> --command="npx" --args="-y,<package>"
claude mcp set-env <name> SOME_TOKEN=...    # 如需环境变量

# 远程
claude mcp add --transport http <name> https://.../mcp/

claude mcp list      # 查看已装
```

---

## 4. Slash 命令 / Subagent / Hook

**识别信号**
- Slash 命令：`.claude/commands/<name>.md`，README 让你「输入 /xxx」。
- Subagent：`.claude/agents/<name>.md`，描述一个专职子代理。
- Hook：在 settings 里挂钩某事件（如每次编辑后跑检查）。

**适配判断**：✅ 原生，但这三类多数是**随 plugin 一起分发**的；单独给的话，按文件放到对应目录即可。

**安装方式**
```bash
mkdir -p ~/.claude/commands && cp <name>.md ~/.claude/commands/   # 个人级命令
mkdir -p ~/.claude/agents   && cp <name>.md ~/.claude/agents/     # 个人级 subagent
# 项目级则放到 .claude/commands 或 .claude/agents
# hook 一般写进 ~/.claude/settings.json 的 hooks 字段（注意备份原文件）
```

---

## 5. 普通 CLI / Python / npm 工具（非原生）

**识别信号**
- 就是个命令行程序或库（pip / npm 包），通篇没提 Claude、agent、MCP、skill。
- 例如文档里上传的 Content Enhancer 用到的 `edge-tts`、`playwright`、`beautifulsoup4`。

**适配判断**：⚠️ 不是 Claude Code 原生扩展，但可以用 Skill 包装经过审查且获授权的本地流程；包装不会扩大底层工具的权限，也不得把访问控制规避能力纳入流程。
- 建议路径：装好底层工具（pip/npm），再写一个薄薄的 SKILL.md 教 Claude 何时、如何调用它。

---

## 6. 别家平台专属

**识别信号**：只给 Cursor / Gemini CLI / Codex / VS Code 的安装说明，没提 Claude Code。

**适配判断**
- 若底层是标准 SKILL.md → 仍可按「类型 1」装进 Claude Code。
- 若是某平台私有插件格式（非 MCP、非 SKILL.md）→ ❌ 不适配，如实告知。

---

## 查重扫描（步骤 3 用）

逐项跑，把已装项的功能描述拉出来和候选比对。

```bash
# 已装的个人 skill + 各自用途
for d in ~/.claude/skills/*/; do
  echo "== $d"; grep -m1 "description:" "$d/SKILL.md" 2>/dev/null
done
# 项目级 skill
ls .claude/skills/ 2>/dev/null

# 已装 MCP
claude mcp list 2>/dev/null || grep -A50 '"mcpServers"' ~/.claude/settings.json

# 已装 plugin
claude plugin list 2>/dev/null

# 命令 / subagent
ls ~/.claude/commands/ ~/.claude/agents/ .claude/commands/ .claude/agents/ 2>/dev/null
```

**用户环境自查（示例，按你自己的环境替换）**：
- 自定义 Claude Code 包装/网关：检查 `~/bin/` 下是否有自定义 CLI，模型/网关配置在 `~/.claude/settings.json`。
- Windows + Git Bash：home 形如 `/c/Users/<你的用户名>/`。
- 桌面端额外配置目录：`C:\Users\<你的用户名>\AppData\Local\Claude-3p\`（`claude mcp list` 偶尔不通时，回退读 `settings.json`）。
- 其他 Agent 环境：按各自技能目录自查（`~/.codex/skills/`、`~/.agents/skills/`、`~/.hermes/skills/` 等）。

**比对原则**：功能描述高度重叠 = 重叠，触发步骤 4 对比；只是同一大类但侧重不同（如都涉及「内容采集」但一个抓网页、一个转音频）= 不算重叠，可共存，注明分工即可。
