import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildPracticeLogEntry } from '../functions/api/minny-practice-log.js';
import { publicMinnyPractice } from '../functions/api/read2lead-progress.js';

const now = new Date('2025-01-01T00:00:00.000Z');
const packId = 'pack123';
const promptId = 'prompt456';
const scorePercent = 75;
const readyForClass = true;

test('buildPracticeLogEntry - no summary (undefined) -> entry without summary key', () => {
  const entry = buildPracticeLogEntry(now, packId, promptId, scorePercent, readyForClass, undefined);
  assert.ok(!('summary' in entry));
  assert.ok(entry.at instanceof Date);
  assert.equal(entry.pack_id, packId);
  assert.equal(entry.prompt_id, promptId);
  assert.equal(entry.score_percent, scorePercent);
  assert.equal(entry.ready_for_class, readyForClass);
});

test('buildPracticeLogEntry - valid summary object -> entry.summary deep equals', () => {
  const summaryObj = { mode: 'homework', turns: 3, match_percent: 82 };
  const entry = buildPracticeLogEntry(now, packId, promptId, scorePercent, readyForClass, summaryObj);
  assert.ok('summary' in entry);
  assert.deepEqual(entry.summary, summaryObj);
  assert.equal(entry.pack_id, packId);
});

test('buildPracticeLogEntry - array as summary -> no summary key', () => {
  const entry = buildPracticeLogEntry(now, packId, promptId, scorePercent, readyForClass, ['not', 'an', 'object']);
  assert.ok(!('summary' in entry));
});

test('buildPracticeLogEntry - null as summary -> no summary key', () => {
  const entry = buildPracticeLogEntry(now, packId, promptId, scorePercent, readyForClass, null);
  assert.ok(!('summary' in entry));
});

test('buildPracticeLogEntry - old callers (no summary) base fields correct', () => {
  // mimic v1 caller: omit summary argument
  const entry = buildPracticeLogEntry(now, packId, promptId, scorePercent, readyForClass);
  assert.ok(!('summary' in entry));
  assert.equal(entry.pack_id, packId);
  assert.equal(entry.prompt_id, promptId);
  assert.equal(entry.score_percent, scorePercent);
  assert.equal(entry.ready_for_class, readyForClass);
  assert.equal(entry.at.toISOString(), now.toISOString());
});

test('publicMinnyPractice - null returns null', () => {
  assert.equal(publicMinnyPractice(null), null);
});

test('publicMinnyPractice - undefined returns null', () => {
  assert.equal(publicMinnyPractice(undefined), null);
});

test('publicMinnyPractice - caps history to most recent 5', () => {
  // history is newest-first (minny-practice-log.js prepends each new entry),
  // so "last 5" means the first 5 array elements, not the last 5 by index.
  const input = {
    last_at: '2026-07-05T00:00:00.000Z',
    history: [{ at: 'a' }, { at: 'b' }, { at: 'c' }, { at: 'd' }, { at: 'e' }, { at: 'f' }, { at: 'g' }],
  };
  const result = publicMinnyPractice(input);
  assert.equal(result.last_at, '2026-07-05T00:00:00.000Z');
  assert.equal(result.history.length, 5);
  assert.deepEqual(result.history, input.history.slice(0, 5));
});

test('publicMinnyPractice - non-array history returns empty array', () => {
  const input = { last_at: null, history: 'not-an-array' };
  const result = publicMinnyPractice(input);
  assert.deepEqual(result.history, []);
});

test('publicMinnyPractice - v1 entry tolerant', () => {
  const v1Obj = {
    schema_version: 1,
    history: [
      { at: 'x', pack_id: 'p1', prompt_id: 'q1', score_percent: 70, ready_for_class: false },
    ],
  };
  const result = publicMinnyPractice(v1Obj);
  assert.ok(result);
  assert.equal(result.history.length, 1);
  assert.ok(!('summary' in result.history[0]));
});

test('speak-up.astro contains expected strings', () => {
  const fileUrl = new URL('../src/pages/speak-up.astro', import.meta.url);
  const text = readFileSync(fileUrl, 'utf8');
  assert.ok(text.includes('minny-practice-log'));
  assert.ok(text.includes('Xong bài tập'));
  assert.ok(text.includes('Khớp bài thầy dạy'));

  const idxXong = text.indexOf('Xong bài tập');
  const idxSummary = text.indexOf('summary:');
  assert.ok(idxXong !== -1);
  assert.ok(idxSummary !== -1);
  assert.ok(idxSummary > idxXong);
});

test('ho-so/index.astro contains ho-so-parent-minny', () => {
  const fileUrl = new URL('../src/pages/ho-so/index.astro', import.meta.url);
  const text = readFileSync(fileUrl, 'utf8');
  assert.ok(text.includes('ho-so-parent-minny'));
});

test('ho-so/ho-so-parent-view.ts contains renderMinnyPractice and Luyện nói cùng Minny', () => {
  const fileUrl = new URL('../src/pages/ho-so/ho-so-parent-view.ts', import.meta.url);
  const text = readFileSync(fileUrl, 'utf8');
  assert.ok(text.includes('renderMinnyPractice'));
  assert.ok(text.includes('Luyện nói cùng Minny'));
});
