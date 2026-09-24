# 多平台 Skill 适配指南

当评估结论为"值得装"但某个 Agent 不适配时，可按以下方式改编。

## 三端适配对照

| 维度 | Hermes | Codex 桌面端 | Claude Code CLI |
|------|--------|-------------|-----------------|
| Skill 目录 | `~/.hermes/skills/<category>/` | 拖文件夹导入 | `~/.claude/skills/<name>/` |
| Skill 格式 | 标准 SKILL.md | 标准 SKILL.md | 标准 SKILL.md |
| 查重方式 | `skills_list()` | `ls ~/.codex/skills/` | `ls ~/.claude/skills/` |
| MCP 支持 | native-mcp (config.yaml) | 需手动配置 | `claude mcp add` |
| Plugin 支持 | ❌ | ❌ | ✅ `/plugin install` |
| 调用方式 | 对话自然语言 | 对话自然语言 | CLI + 对话 |
| 适用场景 | WSL 后台 + 微信 | 桌面端 Cowork | 终端开发 |

## 适配步骤

1. **格式适配**：如果原 SKILL.md 包含某平台专属 frontmatter，清理或替换
2. **路径适配**：将 `~/.hermes/skills/` 替换为目标平台的 skill 目录
3. **命令适配**：将 `skills_list()` / `skill_view()` 替换为 `ls` + `grep` 命令
4. **保留评估框架**：六维评估框架（功能/适配/宣传真实/值得装/安全/可改编）在所有平台通用

## 适配产出规范

当安装一个纯 CLI 工具或标准 SKILL.md 格式的工具后，**主动询问用户是否需要 Codex/Claude Code 适配版**：

### 哪些工具适合三端适配
- ✅ **纯 CLI 工具**（不依赖 Hermes 专属 API）：如 notebooklm-py、officecli、douyin-downloader
- ✅ **标准 SKILL.md**（纯文本，无 Hermes 专属 frontmatter/scripts）
- ❌ **依赖 Hermes 特有功能**的（skills_list/skill_view/hermes config）：只装 Hermes 端

### 产出规范
```
1. 安装 CLI 工具 + 创建 Hermes SKILL.md（到 ~/.hermes/skills/）
2. 复制 Hermes SKILL.md → 修改 frontmatter → 成为 Codex 版
3. 复制 Hermes SKILL.md → 修改 frontmatter + 安装路径 → 成为 Claude Code 版
4. 三个文件都保存到桌面
```

### 三端 SKILL.md 差异速查

| 部分 | Hermes 版 | Codex 版 | Claude Code 版 |
|------|----------|---------|---------------|
| frontmatter name | 不变 | 不变 | 不变 |
| description | 含 Hermes 引用 | 含 Codex 引用 | 含 Claude Code 引用 |
| 安装说明 | 指向 `~/.hermes/skills/` | 指向拖文件夹 | 指向 `~/.claude/skills/` |
| 工具命令 | 不变 | 不变 | 不变 |
| 使用面说明 | 对话可用 | 拖入可用 | CLI/对话可用 |
