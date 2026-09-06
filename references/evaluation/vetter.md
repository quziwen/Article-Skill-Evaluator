# Skill Vetter：安装前代码扫描

`scripts/vetter/` 是评估模式的代码级检查器。它只检查已取得的 Skill 文件，不能替代外部依赖、运行时权限、数据流、供应链和真实行为评估。

## 依赖检查

```text
bash scripts/vetter/check-deps.sh
```

要得到 `SAFE`，aguara、skill-scanner 和 python3 必须都存在且实际完成扫描。脚本不会自动安装软件。历史文件 `install.sh` 现在只给只读检查和提示，不再执行 sudo、包管理、克隆或链接。

## 运行

```text
bash scripts/vetter/vett.sh "<local-path>"
bash scripts/vetter/vett.sh "<github-url>"   # 另需 git
bash scripts/vetter/vett.sh "<registry-name>" # 另需 clawhub
```

## 裁决与退出码

| 裁决 | 退出码 | 含义 | 后续动作 |
|---|---:|---|---|
| `BLOCKED` | 1 | 存在高危发现或危险结构 | 不安装，先修复并复扫 |
| `REVIEW` | 2 | 存在中危或需人工判断的发现 | 人工核对，不能写已通过 |
| `INCOMPLETE` | 2 | 必需扫描器缺失、报错或返回未知结构 | 补齐工具后重跑；不能写 SAFE |
| `SAFE` | 0 | 两个外部扫描器与两个本地检查均真实完成且无发现 | 仅说明本次代码扫描通过 |

`SAFE` 不是“安全认证”，更不是安装、业务准确性或正式验收。扫描器版本、目标 SHA、时间和原始输出需要与评估记录一起保留；外部依赖仍要单独审查。

## 评估模式用法

1. 先固定待评对象及 SHA，再运行依赖检查和 vetter。
2. 把原始裁决写入风险轴，不把 `INCOMPLETE`、`REVIEW` 或未执行改写为通过。
3. `BLOCKED` 命中安装否决；`SAFE` 也只能证明受限的静态扫描结果。
4. 展示报告后等待用户决定，不自动安装、更新或运行外部组件。
