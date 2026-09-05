# Skill Vetter — 安全扫描（评估模式子模块）

skill-vetter 已并入本 Skill 的 `scripts/vetter/`，作为评估模式轴 C 的代码级扫描器。
职责：安装前对 skill/仓库做多扫描器安全体检。**只覆盖 skill 自身的文件，扫不到它调用的外部组件**——外部组件风险在 evaluation-workflow.md 轴 C 里单独评。

## 前置检查

```bash
bash scripts/vetter/check-deps.sh
```

缺依赖按脚本提示安装（aguara、skill-analyzer、python3、curl、jq）。

## 运行扫描

```bash
bash scripts/vetter/vett.sh "<skill-name-or-path>"
```

参数可以是：
- ClawHub skill 名：`youtube-summarize`
- GitHub URL：`https://github.com/user/repo`
- 本地路径：`/tmp/my-skill/`

## 裁决解释

| 裁决 | 含义 | 动作 |
|------|------|------|
| **BLOCKED** | CRITICAL 或 HIGH 发现 | 不要安装，展示发现项 |
| **REVIEW** | 中危发现 | 展示发现项，让用户决定 |
| **SAFE** | 所有扫描通过 | 可继续安装流程 |

## 扫描器清单

| 扫描器 | 检查内容 |
|--------|---------|
| aguara | 提示注入、混淆、可疑 LLM 调用 |
| skill-analyzer | 已知恶意模式、CVE 库 |
| secrets-scan | 硬编码 API key、token、凭据 |
| structure-check | 缺 SKILL.md、YAML 畸形、危险文件 |

## 流程归属

在评估模式下：
1. 评估对象是具体可拉取的 skill/仓库路径、且结论偏向"建议装"时，**安装前**先跑 vetter。
2. 把裁决吸收进轴 C 风险结论：BLOCKED → 最终"不要装"；REVIEW → 至少"中"风险，附人工复核项；SAFE → 代码级无异常。
3. vetter 跑不了（没装/路径变更/拿不到仓库）时如实说"代码级扫描未执行"，不要假装扫过。
4. **绝不自动安装**。展示结果后必须让用户确认。

输出示例（裁决报告尾部）：

```
════════════════════════════════════════════════════════
SKILL VETTER — Security Scan: <name>
[1/4] aguara............. ✅ PASS
[2/4] skill-analyzer..... ❌ FAIL (HIGH: prompt injection pattern)
[3/4] secrets-scan....... ⚠️  WARN (Medium: base64 encoded string)
[4/4] structure-check.... ✅ PASS
VERDICT: BLOCKED
Reason: 1 HIGH, 1 MEDIUM
════════════════════════════════════════════════════════
```