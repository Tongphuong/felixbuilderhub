#!/usr/bin/env node
// Eval: does Minny still interrogate the child in Free Talking?
//
// Measures the QUESTION-RATE — the share of Minny replies that end with a
// question — across a few scripted conversations where the child keeps
// volunteering new information (the exact case that used to trigger the
// "keeps asking questions" interview feel). Target after the react-first
// prompt fix: roughly 40-60%. The old prompt sat near ~100%.
//
// This calls the real production brain (DeepSeek v4 Flash via OpenRouter),
// the same model/endpoint/params minny-conversation.js uses, so it reflects
// live behavior. It runs ONLY when OPENROUTER_API_KEY is set; otherwise it
// prints a skip note and exits 0 (so it never breaks CI or a keyless machine).
//
//   OPENROUTER_API_KEY=... node scripts/eval-minny-question-rate.mjs
//
// It makes network calls and is NOT part of `node --test`; it is a manual
// behavioral check, run by hand when tuning the conversation prompt.

import { buildSystemPrompt, parseModelReply, pickStarterTopic } from '../functions/api/_minny-convo.js';

const CONVO_MODEL = 'deepseek/deepseek-v4-flash'; // must match minny-conversation.js

// Scripted children who ANSWER and keep sharing — the interview-prone case.
// Each is a fixed list of child turns; Minny replies between them. We never
// branch on Minny's reply (kept deterministic and offline-scriptable) — we
// only score whether her replies interrogate.
const SCRIPTS = [
  { level: 'L2', turns: ['I have two cats.', 'They are white and black.', 'Yes and they play a lot.', 'I like to watch them.'] },
  { level: 'L3', turns: ['Today I ate pizza.', 'It was cheese pizza.', 'My mom made it.', 'We ate it together.'] },
  { level: 'L4', turns: ['I love playing football.', 'I play with my friends after school.', 'My team won last week.', 'I scored one goal.'] },
];

function endsWithQuestion(text) {
  return /\?\s*$/.test(String(text || '').trim());
}

async function callMinny(messages) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: CONVO_MODEL,
      messages,
      response_format: { type: 'json_object' },
      max_tokens: 150,
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

async function runScript(script) {
  const starter = pickStarterTopic(script.level, 0);
  const system = buildSystemPrompt(script.level, starter);
  const history = []; // [{ kid_transcript, reply_en, mood }]
  const replies = [];
  for (const kidTurn of script.turns) {
    const messages = [
      { role: 'system', content: system },
      ...history.flatMap((h) => [
        { role: 'user', content: h.kid_transcript },
        { role: 'assistant', content: JSON.stringify({ reply_en: h.reply_en, mood: h.mood }) },
      ]),
      { role: 'user', content: kidTurn },
    ];
    const raw = await callMinny(messages);
    const parsed = parseModelReply(raw);
    const reply_en = parsed?.reply_en ?? '(unparseable reply)';
    const mood = parsed?.mood ?? 'idle';
    replies.push({ kid: kidTurn, minny: reply_en, question: endsWithQuestion(reply_en) });
    history.push({ kid_transcript: kidTurn, reply_en, mood });
  }
  return replies;
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.log('SKIP: OPENROUTER_API_KEY not set — this eval calls the live model.');
    console.log('      Run:  OPENROUTER_API_KEY=... node scripts/eval-minny-question-rate.mjs');
    return;
  }
  let total = 0;
  let questions = 0;
  for (const script of SCRIPTS) {
    console.log(`\n--- ${script.level} ---`);
    const replies = await runScript(script);
    for (const r of replies) {
      total += 1;
      if (r.question) questions += 1;
      console.log(`  child: ${r.kid}`);
      console.log(`  minny: ${r.minny}   ${r.question ? '[Q]' : '[react]'}`);
    }
  }
  const rate = total ? Math.round((questions / total) * 100) : 0;
  console.log(`\nQUESTION-RATE: ${questions}/${total} = ${rate}%  (target ~40-60%; old prompt ~100%)`);
  console.log(rate <= 65 ? 'PASS: Minny reacts more than she interrogates.' : 'WARN: still interview-heavy — revisit the prompt.');
}

main().catch((err) => {
  console.error('eval failed:', err.message);
  process.exit(1);
});
