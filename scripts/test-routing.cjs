#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const skillPath = path.join(__dirname, '..', 'SKILL.md');
const skill = fs.readFileSync(skillPath, 'utf8');

function routePrompt(prompt) {
  const value = String(prompt || '');
  const hasUrl = /https?:\/\//i.test(value);
  if (/(存|归档|保存到知识库|同步)/.test(value)) return 'article-sync';
  if (/(skill|plugin|mcp|cli|agent\s*工具|github\s*工具)/i.test(value) &&
      /(评估|评价|判断|安装|更新|修复|优化|review)/i.test(value)) {
    return 'article-reader:assessment';
  }
  if (hasUrl && (/(读一下|看一下|帮我读|总结|分析|解读|评价|评判|判断|提取观点|这篇讲什么)/.test(value) ||
      /^\s*https?:\/\/\S+\s*$/i.test(value))) {
    return 'article-reader';
  }
  return 'none';
}

const cases = [
  ['https://mp.weixin.qq.com/s/example 读一下', 'article-reader'],
  ['帮我看一下 https://www.toutiao.com/article/example', 'article-reader'],
  ['https://example.com/article', 'article-reader'],
  ['存一下 https://mp.weixin.qq.com/s/example', 'article-sync'],
  ['评估这个 GitHub skill https://github.com/example/tool', 'article-reader:assessment'],
  ['今天天气怎么样', 'none'],
];

for (const [prompt, expected] of cases) {
  assert.equal(routePrompt(prompt), expected, prompt);
}

assert.match(skill, /不要等用户点名 `article-reader`/);
assert.match(skill, /不得先回答“不能读取”再等用户指出 Skill/);
assert.match(skill, /先查询当前可用的专用连接器、API 或 CLI/);
assert.doesNotMatch(skill, /微信、头条及动态页面：优先使用 Codex 当前可用的真实浏览器/);
assert.match(skill, /工具评估与内容增强不再外转到其他技能/);

// Static intent examples and entrypoint checks, not a real Agent/model invocation.
process.stdout.write(`${JSON.stringify({
  status: 'PASS',
  scope: 'static-routing-examples',
  cases: cases.length,
  assertions: [
    'automatic-trigger-without-skill-reminder',
    'read-vs-sync-vs-integrated-assessment-routing',
    'connector-api-cli-before-browser',
    'no-direct-cannot-read',
  ],
}, null, 2)}\n`);
