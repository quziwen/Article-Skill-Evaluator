#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';


const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const renderer = path.join(scriptDir, 'render-quiz.mjs');
const fixture = path.join(scriptDir, 'fixtures', 'quiz-sample.json');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'article-reader-quiz-'));

try {
  const first = spawnSync(process.execPath, [renderer, '--input', fixture, '--format', 'all', '--out-dir', temp], { encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  const summary = JSON.parse(first.stdout);
  assert.equal(summary.status, 'PASS');
  assert.equal(summary.outputs.length, 3);

  const markdown = fs.readFileSync(path.join(temp, 'quiz.md'), 'utf8');
  const html = fs.readFileSync(path.join(temp, 'quiz.html'), 'utf8');
  const csv = fs.readFileSync(path.join(temp, 'flashcards.csv'));
  assert.match(markdown, /查看答案与解析/);
  assert.match(html, /id="submitQuiz"/);
  assert.doesNotMatch(html, /<(script|link)[^>]+(?:src|href)=["']https?:/i);
  assert.equal(csv[0], 0xef);
  assert.equal(csv[1], 0xbb);
  assert.equal(csv[2], 0xbf);

  const refused = spawnSync(process.execPath, [renderer, '--input', fixture, '--format', 'all', '--out-dir', temp], { encoding: 'utf8' });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /EEXIST|exist/i);

  const replaced = spawnSync(process.execPath, [renderer, '--input', fixture, '--format', 'all', '--out-dir', temp, '--overwrite'], { encoding: 'utf8' });
  assert.equal(replaced.status, 0, replaced.stderr);
  process.stdout.write(`${JSON.stringify({ status: 'PASS', outputs: 3, overwrite_guard: true })}\n`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
