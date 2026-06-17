import assert from 'node:assert/strict';
import test from 'node:test';

import { extractV2Pack } from '../functions/api/_read2lead-lesson-extract.js';
import { buildV2LessonPayload } from '../functions/api/read2lead-lesson.js';
import {
  isV2PackSchemaVersion,
  lessonSchemaVersionFromPack,
  packHasV2Schema,
} from '../functions/api/_read2lead-pack-schema.js';

const MINI_V21 = {
  schema_version: '2.1',
  student_name: 'Long',
  level: 'L1',
  story: { title: 'Test', paragraphs_en: ['Hi.'], sentences: [{ text_en: 'Hi.', paragraph_index: 0 }] },
  activities: [{ type: 'story_discovery', items: [] }],
};

test('isV2PackSchemaVersion accepts 2 and 2.1', () => {
  assert.equal(isV2PackSchemaVersion(2), true);
  assert.equal(isV2PackSchemaVersion('2'), true);
  assert.equal(isV2PackSchemaVersion('2.0'), true);
  assert.equal(isV2PackSchemaVersion('2.1'), true);
  assert.equal(isV2PackSchemaVersion(1), false);
  assert.equal(isV2PackSchemaVersion('1'), false);
});

test('extractV2Pack reads review_context with schema_version 2.1', () => {
  const pack = {
    pack_id: 'p1',
    status: 'awaiting_review',
    review_context: MINI_V21,
  };
  assert.ok(extractV2Pack(pack));
  assert.equal(extractV2Pack(pack).schema_version, '2.1');
});

test('packHasV2Schema detects nested review_context 2.1', () => {
  assert.equal(packHasV2Schema({ review_context: MINI_V21 }), true);
  assert.equal(packHasV2Schema({ schema_version: 1 }), false);
});

test('buildV2LessonPayload preserves schema_version 2.1', () => {
  const lesson = buildV2LessonPayload({
    accessCode: 'R2L-TEST-1234',
    codeData: { progress: {}, student_profile: {} },
    pack: { pack_id: 'p1', status: 'awaiting_review' },
    v2Pack: MINI_V21,
    env: {},
  });
  assert.equal(lesson.schema_version, '2.1');
  assert.equal(lessonSchemaVersionFromPack(MINI_V21), '2.1');
});
