#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';


function parseArgs(argv) {
  const options = { format: 'markdown', overwrite: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--overwrite') options.overwrite = true;
    else if (value === '--input') options.input = argv[++index];
    else if (value === '--format') options.format = argv[++index];
    else if (value === '--out') options.out = argv[++index];
    else if (value === '--out-dir') options.outDir = argv[++index];
    else throw new Error(`unknown argument: ${value}`);
  }
  if (!options.input) throw new Error('--input is required');
  if (!['markdown', 'html', 'anki', 'all'].includes(options.format)) {
    throw new Error('--format must be markdown, html, anki, or all');
  }
  if (options.format === 'all' && !options.outDir) throw new Error('--out-dir is required for --format all');
  if (options.format !== 'all' && !options.out) throw new Error('--out is required for a single format');
  return options;
}


function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}


function validateBundle(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('input must be an object');
  const title = nonEmpty(input.title, 'title');
  if (!Array.isArray(input.questions) || input.questions.length === 0) throw new Error('questions must be a non-empty array');
  const questions = input.questions.map((question, index) => {
    const type = nonEmpty(question.type, `questions[${index}].type`);
    if (!['single_choice', 'short_answer'].includes(type)) throw new Error(`unsupported question type: ${type}`);
    const normalized = {
      id: nonEmpty(question.id || `q${index + 1}`, `questions[${index}].id`),
      type,
      prompt: nonEmpty(question.prompt, `questions[${index}].prompt`),
      answer: nonEmpty(question.answer, `questions[${index}].answer`),
      explanation: nonEmpty(question.explanation, `questions[${index}].explanation`),
    };
    if (type === 'single_choice') {
      if (!Array.isArray(question.options) || question.options.length < 2) {
        throw new Error(`questions[${index}].options must contain at least two choices`);
      }
      normalized.options = question.options.map((option, choice) => nonEmpty(option, `questions[${index}].options[${choice}]`));
      const letterIndex = /^[A-Z]$/i.test(normalized.answer) ? normalized.answer.toUpperCase().charCodeAt(0) - 65 : -1;
      const textIndex = normalized.options.indexOf(normalized.answer);
      normalized.correctIndex = letterIndex >= 0 ? letterIndex : textIndex;
      if (normalized.correctIndex < 0 || normalized.correctIndex >= normalized.options.length) {
        throw new Error(`questions[${index}].answer does not identify an option`);
      }
    }
    return normalized;
  });
  const flashcards = Array.isArray(input.flashcards) ? input.flashcards.map((card, index) => ({
    front: nonEmpty(card.front, `flashcards[${index}].front`),
    back: nonEmpty(card.back, `flashcards[${index}].back`),
    tags: Array.isArray(card.tags) ? card.tags.map((tag, tagIndex) => nonEmpty(tag, `flashcards[${index}].tags[${tagIndex}]`)) : [],
  })) : [];
  return { title, source_url: typeof input.source_url === 'string' ? input.source_url : '', questions, flashcards };
}


function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}


function renderMarkdown(bundle) {
  const lines = [`# Quiz - 《${bundle.title}》`, ''];
  if (bundle.source_url) lines.push(`来源：${bundle.source_url}`, '');
  bundle.questions.forEach((question, index) => {
    lines.push(`## ${index + 1}. ${question.prompt}`, '');
    if (question.type === 'single_choice') {
      question.options.forEach((option, choice) => lines.push(`- ${String.fromCharCode(65 + choice)}. ${option}`));
      lines.push('');
    }
    lines.push('<details><summary>查看答案与解析</summary>', '', `答案：${question.answer}`, '', `解析：${question.explanation}`, '', '</details>', '');
  });
  if (bundle.flashcards.length) {
    lines.push('## 闪卡', '', '| 正面 | 背面 |', '|---|---|');
    bundle.flashcards.forEach((card) => lines.push(`| ${card.front.replaceAll('|', '\\|')} | ${card.back.replaceAll('|', '\\|')} |`));
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}


function renderHtml(bundle) {
  const safeData = JSON.stringify(bundle).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(bundle.title)} - Quiz</title>
<style>body{margin:0;background:#f4f6f8;color:#18202a;font:16px/1.6 system-ui,sans-serif}.wrap{max-width:760px;margin:auto;padding:24px}.card{background:#fff;border-radius:14px;padding:20px;margin:16px 0;box-shadow:0 4px 18px #0001}.choice{display:block;padding:8px 0}.answer{margin-top:12px;padding:12px;background:#eef5ff;border-radius:8px}button{border:0;border-radius:9px;background:#246bfe;color:#fff;padding:12px 20px;font-size:16px}.muted{color:#64748b;word-break:break-all}</style>
</head><body><main class="wrap"><h1>${escapeHtml(bundle.title)}</h1><p class="muted" id="source"></p><section id="questions"></section><button id="submitQuiz" type="button">提交并查看结果</button><h2 id="score" aria-live="polite"></h2></main>
<script>const DATA=${safeData};const host=document.getElementById('questions');document.getElementById('source').textContent=DATA.source_url?('来源：'+DATA.source_url):'';DATA.questions.forEach((q,i)=>{const card=document.createElement('section');card.className='card';const h=document.createElement('h2');h.textContent=(i+1)+'. '+q.prompt;card.appendChild(h);if(q.type==='single_choice'){q.options.forEach((text,j)=>{const label=document.createElement('label');label.className='choice';const radio=document.createElement('input');radio.type='radio';radio.name=q.id;radio.value=String(j);label.append(radio,document.createTextNode(' '+String.fromCharCode(65+j)+'. '+text));card.appendChild(label)})}else{const note=document.createElement('p');note.textContent='请先口头或书面作答，再提交查看参考答案。';card.appendChild(note)}const answer=document.createElement('div');answer.className='answer';answer.hidden=true;answer.textContent='答案：'+q.answer+'；解析：'+q.explanation;card.appendChild(answer);host.appendChild(card)});document.getElementById('submitQuiz').addEventListener('click',()=>{let correct=0,total=0;DATA.questions.forEach((q,i)=>{document.querySelectorAll('.answer')[i].hidden=false;if(q.type==='single_choice'){total++;const picked=document.querySelector('input[name="'+CSS.escape(q.id)+'"]:checked');if(picked&&Number(picked.value)===q.correctIndex)correct++}});document.getElementById('score').textContent=total?('选择题得分：'+correct+'/'+total):'参考答案已展开'})</script>
</body></html>\n`;
}


function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}


function renderAnki(bundle) {
  if (!bundle.flashcards.length) throw new Error('flashcards must be non-empty for Anki output');
  const rows = ['正面,背面,标签'];
  bundle.flashcards.forEach((card) => rows.push([card.front, card.back, card.tags.join(' ')].map(csvCell).join(',')));
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}


function writeOutput(target, content, overwrite) {
  const resolved = path.resolve(target);
  const parent = path.dirname(resolved);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) throw new Error(`output directory does not exist: ${parent}`);
  fs.writeFileSync(resolved, content, { encoding: 'utf8', flag: overwrite ? 'w' : 'wx' });
  return resolved;
}


function main() {
  const options = parseArgs(process.argv.slice(2));
  const source = JSON.parse(fs.readFileSync(path.resolve(options.input), 'utf8').replace(/^\uFEFF/, ''));
  const bundle = validateBundle(source);
  const outputs = [];
  if (options.format === 'all') {
    const directory = path.resolve(options.outDir);
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) throw new Error(`output directory does not exist: ${directory}`);
    outputs.push(writeOutput(path.join(directory, 'quiz.md'), renderMarkdown(bundle), options.overwrite));
    outputs.push(writeOutput(path.join(directory, 'quiz.html'), renderHtml(bundle), options.overwrite));
    outputs.push(writeOutput(path.join(directory, 'flashcards.csv'), renderAnki(bundle), options.overwrite));
  } else {
    const render = options.format === 'markdown' ? renderMarkdown : options.format === 'html' ? renderHtml : renderAnki;
    outputs.push(writeOutput(options.out, render(bundle), options.overwrite));
  }
  process.stdout.write(`${JSON.stringify({ status: 'PASS', format: options.format, outputs })}\n`);
}


try {
  main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: 'ERROR', error: error.message })}\n`);
  process.exitCode = 2;
}
