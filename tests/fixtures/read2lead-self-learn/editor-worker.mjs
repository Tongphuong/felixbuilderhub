/** Marked synthetic database only: contention and real process-death fixture. */
import { readFileSync } from 'node:fs';
import { SyntheticEditorStore } from '../../../scripts/lib/read2lead-self-learn-editor.mjs';
const read = name => JSON.parse(readFileSync(new URL('./' + name + '.json', import.meta.url)));
const [root, operation, boundary = '', requestId = 'worker-request'] = process.argv.slice(2);
const lesson = read('level-lessons').lessons[2], access = read('editor-access').accounts[0], now = '2026-09-19T04:00:00Z';
const store = new SyntheticEditorStore({ mode: 'synthetic-local', root, fault(name) { if (name === boundary) process.kill(process.pid, 'SIGKILL'); } });
try {
  const p = operation === 'init' ? null : store.authenticate(access.editor_id, access.access_secret), common = { request_id: requestId, lesson_id: lesson.id };
  let result;
  if (operation === 'init') result = { ok: true };
  else if (operation === 'save') result = await store.saveDraft(p, { request_id: requestId, expected_revision: 0, lesson }, now);
  else if (operation === 'request') result = store.requestReview(p, { ...common, expected_revision: 1 }, now);
  else if (operation === 'review') result = await store.review(p, { ...common, expected_revision: 2, decision: 'qa_ready', note: 'Synthetic technical checks only.' }, now);
  else if (operation === 'publish') result = store.publishQA(p, { ...common, expected_revision: 3 }, now);
  else if (operation === 'quarantine' || operation === 'release') result = await store.setQuarantine(p, { ...common, expected_revision: operation === 'quarantine' ? 4 : 5, content_revision: 1, blocked: operation === 'quarantine', reason: 'Synthetic availability check.' }, now);
  else throw Error('unknown_fixture_operation');
  console.log(JSON.stringify(result));
} catch (error) { console.log(JSON.stringify({ error: error.code || error.message })); process.exitCode = 2; }
finally { store.close(); }
