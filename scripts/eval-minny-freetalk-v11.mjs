#!/usr/bin/env node
// Eval: V1.1 free-talk brain -- does the level-branched prompt actually
// deliver the spec's acceptance criteria against the LIVE model?
// (pattern-copy of scripts/eval-minny-question-rate.mjs)
//
// Runs 3 scripted L1 conversations + 2 L3 topic conversations + 1 L4 debate
// conversation against the real production brain (Llama-3.3-70B via
// OpenRouter, same model/provider minny-conversation.js uses) and reports:
//
//   (a) % of L1-L2 question-turns carrying valid options+expected (target >=80%)
//   (b) hints present on L3+ turns, and never leaking into reply_en
//   (c) overall question-rate across every turn (target ~40-60%)
//   (d) debate replies never introduce a stance outside the assigned,
//       allowlisted debate topic
//
// Runs ONLY when OPENROUTER_API_KEY is set; otherwise prints a skip note
// and exits 0 (never breaks CI or a keyless machine). It makes network
// calls and is NOT part of `node --test` -- a manual behavioral check, run
// by hand when tuning the V1.1 prompt.
//
//   OPENROUTER_API_KEY=... node scripts/eval-minny-freetalk-v11.mjs

import {
  buildSystemPrompt, parseModelReply, gateReplyForLevel, pickStarterTopic,
  TOPIC_SEEDS, DEBATE_TOPICS,
} from '../functions/api/_minny-convo.js';

// Must match minny-conversation.js's CONVO_MODEL/CONVO_PROVIDER.
const CONVO_MODEL = 'meta-llama/llama-3.3-70b-instruct';
const CONVO_PROVIDER = { sort: 'throughput', require_parameters: true };

const L1_SCRIPTS = [
  { level: 'L1', turns: ['hello', 'i like dog', 'yes soft'] },
  { level: 'L2', turns: ['hi', 'i eat rice', 'yes with mom'] },
  { level: 'L1', turns: ['hello minny', 'cat', 'yes big'] },
];

const L3_TOPIC_SCRIPTS = [
  { level: 'L3', topic: 'animals_pets', turns: ['I have a dog his name is Bun.', 'yes he play ball', 'we go to the park'] },
  { level: 'L3', topic: 'food_cooking', turns: ['I ate rice for lunch.', 'my mom cooked it', 'it was very yummy'] },
];

const L4_DEBATE_SCRIPT = {
  level: 'L4', topic: 'animals_pets', game: 'debate', debateTopic: DEBATE_TOPICS[0],
  turns: ['I think dogs are better because they play with you.', 'but cats are soft too', 'I still like dogs more'],
};

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
      provider: CONVO_PROVIDER,
      messages,
      response_format: { type: 'json_object' },
      max_tokens: 150,
      temperature: 0.8,
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

async function runScript(script) {
  const starter = pickStarterTopic(script.level, 0);
  const system = buildSystemPrompt(script.level, starter, {
    topic: script.topic || null,
    game: script.game || null,
    debateTopic: script.debateTopic || null,
  });
  const history = [];
  const turns = [];
  for (const kidTurn of script.turns) {
    const messages = [
      { role: 'system', content: system },
      ...history.flatMap((h) => [
        { role: 'user', content: h.kid_transcript },
        { role: 'assistant', content: JSON.stringify(h.raw) },
      ]),
      { role: 'user', content: kidTurn },
    ];
    const raw = await callMinny(messages);
    const parsed = parseModelReply(raw);
    const gated = parsed ? gateReplyForLevel(parsed, script.level) : null;
    turns.push({ kid: kidTurn, parsed, gated });
    history.push({ kid_transcript: kidTurn, raw: parsed || { reply_en: '(unparseable)', mood: 'idle' } });
  }
  return turns;
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.log('SKIP: OPENROUTER_API_KEY not set — this eval calls the live model.');
    console.log('      Run:  OPENROUTER_API_KEY=... node scripts/eval-minny-freetalk-v11.mjs');
    return;
  }

  let totalTurns = 0;
  let questionTurns = 0;

  // (a) L1-L2: question-turns carrying valid options+expected.
  let l1l2Questions = 0;
  let l1l2QuestionsWithChips = 0;
  console.log('\n=== L1-L2 scripts ===');
  for (const script of L1_SCRIPTS) {
    console.log(`\n--- ${script.level} ---`);
    const turns = await runScript(script);
    for (const t of turns) {
      totalTurns += 1;
      const replyEn = t.gated?.reply_en ?? '(unparseable)';
      const isQuestion = endsWithQuestion(replyEn);
      if (isQuestion) questionTurns += 1;
      console.log(`  child: ${t.kid}`);
      console.log(`  minny: ${replyEn}   ${isQuestion ? '[Q]' : '[react]'}${t.gated?.options ? ` options=${JSON.stringify(t.gated.options)}` : ''}`);
      if (isQuestion) {
        l1l2Questions += 1;
        const hasChips = Array.isArray(t.gated?.options) && t.gated.options.length > 0 && Array.isArray(t.gated?.expected) && t.gated.expected.length > 0;
        if (hasChips) l1l2QuestionsWithChips += 1;
      }
    }
  }
  const chipRate = l1l2Questions ? Math.round((l1l2QuestionsWithChips / l1l2Questions) * 100) : 0;
  console.log(`\n(a) L1-L2 question-turns carrying valid options+expected: ${l1l2QuestionsWithChips}/${l1l2Questions} = ${chipRate}% (target >=80%)`);

  // (b) L3+ topic scripts: hint present, never leaking into reply_en.
  let l3Turns = 0;
  let l3TurnsWithHint = 0;
  let hintLeaks = 0;
  console.log('\n=== L3 topic scripts ===');
  for (const script of L3_TOPIC_SCRIPTS) {
    console.log(`\n--- ${script.level} / ${script.topic} ---`);
    const turns = await runScript(script);
    for (const t of turns) {
      totalTurns += 1;
      const replyEn = t.gated?.reply_en ?? '(unparseable)';
      const isQuestion = endsWithQuestion(replyEn);
      if (isQuestion) questionTurns += 1;
      console.log(`  child: ${t.kid}`);
      console.log(`  minny: ${replyEn}   ${isQuestion ? '[Q]' : '[react]'}${t.gated?.hint ? ` hint=${JSON.stringify(t.gated.hint)}` : ' (no hint)'}`);
      l3Turns += 1;
      if (t.gated?.hint) {
        l3TurnsWithHint += 1;
        if (replyEn.toLowerCase().includes(String(t.gated.hint).toLowerCase())) {
          hintLeaks += 1;
          console.log('  WARN: hint text leaked into reply_en!');
        }
      }
    }
  }
  const hintRate = l3Turns ? Math.round((l3TurnsWithHint / l3Turns) * 100) : 0;
  console.log(`\n(b) L3+ turns carrying a hint: ${l3TurnsWithHint}/${l3Turns} = ${hintRate}%; hint-leaked-into-reply_en violations: ${hintLeaks}`);

  // (d) L4 debate: reply never introduces a stance outside the assigned topic.
  console.log('\n=== L4 debate script ===');
  const otherDebateTopics = DEBATE_TOPICS.filter((t) => t !== L4_DEBATE_SCRIPT.debateTopic);
  let debateOffAllowlist = 0;
  const debateTurns = await runScript(L4_DEBATE_SCRIPT);
  for (const t of debateTurns) {
    totalTurns += 1;
    const replyEn = t.gated?.reply_en ?? '(unparseable)';
    const isQuestion = endsWithQuestion(replyEn);
    if (isQuestion) questionTurns += 1;
    console.log(`  child: ${t.kid}`);
    console.log(`  minny: ${replyEn}   ${isQuestion ? '[Q]' : '[react]'}`);
    // Heuristic: the reply should never assert one of the OTHER allowlisted
    // debate positions verbatim (a sign the model drifted to a different
    // stance than the one we assigned).
    if (otherDebateTopics.some((topic) => replyEn.includes(topic))) {
      debateOffAllowlist += 1;
      console.log('  WARN: reply appears to assert a different debate topic!');
    }
  }
  console.log(`\n(d) Debate topic assigned: "${L4_DEBATE_SCRIPT.debateTopic}" (from the allowlist); off-allowlist drift detected: ${debateOffAllowlist}/${debateTurns.length}`);

  // (c) overall question-rate.
  const rate = totalTurns ? Math.round((questionTurns / totalTurns) * 100) : 0;
  console.log(`\n(c) QUESTION-RATE (all scripts): ${questionTurns}/${totalTurns} = ${rate}%  (target ~40-60%)`);

  console.log('\n=== SUMMARY ===');
  console.log(`(a) L1-L2 chip coverage: ${chipRate}%  ${chipRate >= 80 ? 'PASS' : 'WARN: below 80% target'}`);
  console.log(`(b) L3+ hint coverage: ${hintRate}%, leaks: ${hintLeaks}  ${hintLeaks === 0 ? 'PASS (no leaks)' : 'WARN: hint leaked into reply_en'}`);
  console.log(`(c) question-rate: ${rate}%  ${rate >= 40 && rate <= 60 ? 'PASS' : 'WARN: outside 40-60% target'}`);
  console.log(`(d) debate allowlist adherence: ${debateOffAllowlist === 0 ? 'PASS' : 'WARN: possible off-allowlist drift'}`);
}

main().catch((err) => {
  console.error('eval failed:', err.message);
  process.exit(1);
});
