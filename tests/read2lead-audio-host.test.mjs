import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteAudioHost } from '../functions/api/_read2lead-audio-url.js';
import { ensureSixActivities } from '../functions/api/_read2lead-lesson-activities.js';
import { buildV2LessonPayload } from '../functions/api/read2lead-lesson.js';

const ENV = { R2L_AUDIO_HOST: 'https://audio.felixbuilderhub.com' };
const R2_DEV_URL = 'https://pub-abc123.r2.dev/packs/x.mp3';
const CUSTOM_URL = 'https://audio.felixbuilderhub.com/packs/x.mp3';

test('rewriteAudioHost swaps the r2.dev host and preserves the object path', () => {
  assert.equal(rewriteAudioHost(R2_DEV_URL, ENV), CUSTOM_URL);
  assert.equal(
    rewriteAudioHost(R2_DEV_URL, { R2L_AUDIO_HOST: 'https://audio.felixbuilderhub.com/' }),
    CUSTOM_URL,
  );
});

test('rewriteAudioHost leaves other hosts and non-string values unchanged', () => {
  const otherUrl = 'https://example.com/packs/x.mp3';
  assert.equal(rewriteAudioHost(otherUrl, ENV), otherUrl);
  assert.equal(rewriteAudioHost(R2_DEV_URL, {}), R2_DEV_URL);
  assert.equal(rewriteAudioHost(null, ENV), null);
  assert.equal(rewriteAudioHost(42, ENV), 42);
});

test('lesson payload rewrites story and sentence audio using the request env', () => {
  const lesson = buildV2LessonPayload({
    accessCode: 'R2L-TEST-1234',
    codeData: {},
    pack: { pack_id: 'pack-1', status: 'ready' },
    v2Pack: {
      story: {
        full_audio_url: R2_DEV_URL,
        sentences: [
          { text: 'One.', audio_url: R2_DEV_URL },
          { text: 'Two.', audio_url: 'https://example.com/two.mp3' },
        ],
      },
      activities: [],
    },
    env: ENV,
  });

  assert.equal(lesson.story.full_audio_url, CUSTOM_URL);
  assert.equal(lesson.story.sentences[0].audio_url, CUSTOM_URL);
  assert.equal(lesson.story.sentences[1].audio_url, 'https://example.com/two.mp3');
});

test('activity items rewrite r2.dev audio without changing activity shape', () => {
  const itemWithoutAudio = { text_en: 'No audio.' };
  const activities = ensureSixActivities(
    [
      {
        type: 'listen_and_speak',
        items: [{ text_en: 'Hello.', audio_url: R2_DEV_URL }, itemWithoutAudio],
      },
    ],
    null,
    ENV,
  );

  assert.equal(activities[0].items[0].audio_url, CUSTOM_URL);
  assert.equal(activities[0].items[0].text_en, 'Hello.');
  assert.deepEqual(activities[0].items[1], itemWithoutAudio);
  assert.equal(Object.hasOwn(activities[0].items[1], 'audio_url'), false);
});
