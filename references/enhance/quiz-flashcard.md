# Quiz / 闪卡生成

从已经取得的文章内容提炼可核对的知识点，生成自测题和闪卡。不得补入文章没有提供的事实。

## 形态选择和写入边界

- 用户未指定形态：直接在对话中给 Markdown 测验，不创建文件。
- 用户明确要求 HTML：生成单文件离线测验页，只写用户要求的输出文件。
- 用户明确要求 Anki：生成 UTF-8 BOM CSV，只写用户要求的输出文件。
- 用户明确要求 Markdown 文件或同时要三种文件时，才把相应文件写到其指定目录。
- 已有文件默认不覆盖；只有用户明确允许替换时才使用 `--overwrite`。

## 内容要求

1. 从文章中提取概念、数据、结论和方法，并保留来源链接。
2. 通常生成 3—5 道题，选择题与问答题可以混合；闪卡通常 5—10 张。
3. 每题必须有答案和解析；专业文章优先检查数据口径、关键结论和步骤。
4. HTML 必须将 CSS 和 JavaScript 内联，不使用 CDN、远程脚本或远程字体。
5. Anki CSV 使用 `正面,背面,标签` 三列，UTF-8 BOM 编码。

## 可重复渲染器

先按 `scripts/fixtures/quiz-sample.json` 的结构准备 JSON；这是内容契约，不要求照抄样例答案。然后从 Skill 根目录运行：

```text
node scripts/render-quiz.mjs --input <quiz.json> --format markdown --out <quiz.md>
node scripts/render-quiz.mjs --input <quiz.json> --format html --out <quiz.html>
node scripts/render-quiz.mjs --input <quiz.json> --format anki --out <flashcards.csv>
node scripts/render-quiz.mjs --input <quiz.json> --format all --out-dir <existing-directory>
node scripts/test-quiz-renderer.mjs
```

渲染器会校验必填字段、选择题答案与选项的对应关系、闪卡字段、输出目录及覆盖条件。`--format all` 固定生成 `quiz.md`、`quiz.html`、`flashcards.csv`。

## 对话内格式

```markdown
## Quiz - 《文章标题》

1. 问题？
   - A. 选项
   - B. 选项

<details><summary>查看答案与解析</summary>

答案：A

解析：依据文章中的……

</details>
```

纯文本环境不能声称“可点击交互组件已经渲染”；应使用 Markdown 作答和答案折叠。HTML 版的自动判分仅证明页面逻辑可运行，不证明题目本身正确，题目仍需与原文逐条核对。
