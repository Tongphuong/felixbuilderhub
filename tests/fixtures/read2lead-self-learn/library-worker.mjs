/** Hard-exit/contention fixture, restricted by the marked synthetic library store. */
import { readFileSync } from 'node:fs';
import { SyntheticFamilyStore } from '../../../scripts/lib/read2lead-self-learn-family.mjs';
import { SyntheticLibraryStore } from '../../../scripts/lib/read2lead-self-learn-library.mjs';
const read = name => JSON.parse(readFileSync(new URL('./' + name + '.json', import.meta.url)));
const [root, operation, boundary = '', requestId = 'worker-request'] = process.argv.slice(2);
const family = new SyntheticFamilyStore({ mode: 'synthetic-local', root });
const catalogue = read('level-lessons'), interests = read('library-interests'), lesson = catalogue.lessons[2];
const library = await SyntheticLibraryStore.open({ mode: 'synthetic-local', root, catalogue, interests,
  fault(name) { if (name === boundary) process.kill(process.pid, 'SIGKILL'); } });
try {
  const principal = { ...family.authenticateAccess('DEMO-FAMILY-A'), childId: 'synthetic-an' }, now = '2026-09-18T15:00:00Z';
  let result;
  if (operation === 'interests') result = library.setInterests(principal, { request_id: requestId, expected_revision: 0, interest_ids: ['nature'] }, now);
  else if (operation === 'favorite') result = library.setFavorite(principal, { request_id: requestId, expected_revision: 0, lesson_id: lesson.id, favorite: true }, now);
  else if (operation === 'open') result = library.openReading(principal, { request_id: requestId, lesson_id: lesson.id }, now);
  else if (operation === 'update') {
    const reading = library.view(principal).reading_history[0];
    result = library.updateReading(principal, { request_id: requestId, reading_id: reading.reading_id, expected_revision: 0, sentence_id: lesson.story.sentences[1].id, marked_finished: true }, now);
  } else throw Error('unknown_fixture_operation');
  console.log(JSON.stringify(result));
} catch (error) { console.log(JSON.stringify({ error: error.code || error.message })); process.exitCode = 2; }
finally { library.close(); family.close(); }
