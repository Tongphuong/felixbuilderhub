/**
 * Content validator for Shadowing video JSON files (`src/data/shadowing/
 * <slug>.json`). Used by both `scripts/prep-shadowing-video.mjs` (offline,
 * before writing a new file) and, potentially, the page itself as a last
 * line of defense against a hand-edited file. Zero imports, plain ESM.
 *
 * Schema (spec SPEC_SPEAKUP_SHADOWING.md):
 *   { schema_version: 1, id: slug, youtube_id: 11-char id, title_vi,
 *     title_en, level: 'L1'..'L5', duration_s: number, prepared_at: ISO
 *     string, source: { caption_kind: 'manual'|'auto' },
 *     segments: [{ i, start, end, text_en, text_vi?, shadow }],
 *     questions: [{ id, after_segment, type: 'yes_no'|'choice',
 *       question_en, question_vi, options_en?, options_vi?,
 *       correct_index?, answer? }] }
 *
 * `validateShadowingVideo` collects EVERY error before returning (never
 * stops at the first) so a broken prep run or hand-edit gets one full
 * report, not a fix-one-rerun-find-the-next loop.
 */

const LEVELS = new Set(['L1', 'L2', 'L3', 'L4', 'L5']);
const CAPTION_KINDS = new Set(['manual', 'auto']);
const QUESTION_TYPES = new Set(['yes_no', 'choice']);

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isIsoDateString(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  return !Number.isNaN(Date.parse(value));
}

/**
 * @param {unknown} json
 * @returns {{ ok: boolean, errors: string[], video: object }}
 */
export function validateShadowingVideo(json) {
  const errors = [];
  const src = isPlainObject(json) ? json : {};
  if (!isPlainObject(json)) errors.push('video must be an object');

  // --- top-level scalar fields ---------------------------------------
  if (src.schema_version !== 1) errors.push('schema_version must be exactly 1');

  if (!isNonEmptyString(src.id) || !SLUG_RE.test(src.id)) {
    errors.push('id must be a slug (lowercase letters/digits, hyphen-separated)');
  }

  if (!isNonEmptyString(src.youtube_id) || !YOUTUBE_ID_RE.test(src.youtube_id)) {
    errors.push('youtube_id must be an 11-character YouTube video id');
  }

  if (!isNonEmptyString(src.title_vi)) errors.push('title_vi must be a non-empty string');
  if (!isNonEmptyString(src.title_en)) errors.push('title_en must be a non-empty string');

  if (typeof src.level !== 'string' || !LEVELS.has(src.level)) {
    errors.push("level must be one of 'L1'..'L5'");
  }

  if (!isFiniteNumber(src.duration_s) || src.duration_s <= 0) {
    errors.push('duration_s must be a positive number');
  }

  if (!isIsoDateString(src.prepared_at)) errors.push('prepared_at must be an ISO date string');

  if (!isPlainObject(src.source) || typeof src.source.caption_kind !== 'string'
    || !CAPTION_KINDS.has(src.source.caption_kind)) {
    errors.push("source.caption_kind must be one of 'manual'|'auto'");
  }

  // --- segments --------------------------------------------------------
  const segmentsInput = Array.isArray(src.segments) ? src.segments : null;
  if (!segmentsInput) {
    errors.push('segments must be an array');
  } else if (segmentsInput.length === 0) {
    errors.push('segments must be non-empty');
  }

  const segments = [];
  if (segmentsInput) {
    let prevEnd = null;
    segmentsInput.forEach((seg, index) => {
      const label = `segments[${index}]`;
      if (!isPlainObject(seg)) {
        errors.push(`${label} must be an object`);
        segments.push(null);
        return;
      }
      if (seg.i !== index) errors.push(`${label}.i must equal its 0-based index (${index})`);

      const start = isFiniteNumber(seg.start) ? seg.start : null;
      const end = isFiniteNumber(seg.end) ? seg.end : null;
      if (start === null) errors.push(`${label}.start must be a number`);
      if (end === null) errors.push(`${label}.end must be a number`);
      if (start !== null && end !== null && !(end > start)) {
        errors.push(`${label}.end must be greater than ${label}.start`);
      }
      if (start !== null && prevEnd !== null && start < prevEnd) {
        errors.push(`${label}.start must not overlap the previous segment's end`);
      }
      if (end !== null) prevEnd = end;

      if (!isNonEmptyString(seg.text_en)) errors.push(`${label}.text_en must be a non-empty string`);
      if (seg.text_vi !== undefined && typeof seg.text_vi !== 'string') {
        errors.push(`${label}.text_vi must be a string when present`);
      }
      if (typeof seg.shadow !== 'boolean') errors.push(`${label}.shadow must be a boolean`);

      segments.push({
        i: index,
        start: start ?? seg.start,
        end: end ?? seg.end,
        text_en: seg.text_en,
        ...(seg.text_vi !== undefined ? { text_vi: seg.text_vi } : {}),
        shadow: seg.shadow,
      });
    });
  }

  // --- questions ---------------------------------------------------------
  const questionsInput = Array.isArray(src.questions) ? src.questions : null;
  if (!questionsInput) errors.push('questions must be an array');

  const questions = [];
  if (questionsInput) {
    questionsInput.forEach((q, index) => {
      const label = `questions[${index}]`;
      if (!isPlainObject(q)) {
        errors.push(`${label} must be an object`);
        questions.push(null);
        return;
      }
      if (!isNonEmptyString(q.id)) errors.push(`${label}.id must be a non-empty string`);

      const afterSegment = q.after_segment;
      const validAfterSegmentRange = segmentsInput
        ? Number.isInteger(afterSegment) && afterSegment >= 0 && afterSegment < segmentsInput.length
        : Number.isInteger(afterSegment) && afterSegment >= 0;
      if (!validAfterSegmentRange) {
        errors.push(`${label}.after_segment must be a valid segment index`);
      }

      if (typeof q.type !== 'string' || !QUESTION_TYPES.has(q.type)) {
        errors.push(`${label}.type must be one of 'yes_no'|'choice'`);
      }

      if (!isNonEmptyString(q.question_en)) errors.push(`${label}.question_en must be a non-empty string`);
      if (!isNonEmptyString(q.question_vi)) errors.push(`${label}.question_vi must be a non-empty string`);

      if (q.type === 'yes_no') {
        if (typeof q.answer !== 'boolean') errors.push(`${label}.answer must be a boolean for type 'yes_no'`);
        if (q.options_en !== undefined || q.options_vi !== undefined) {
          errors.push(`${label} must not have options_en/options_vi for type 'yes_no'`);
        }
      } else if (q.type === 'choice') {
        const optsEn = Array.isArray(q.options_en) ? q.options_en : null;
        const optsVi = Array.isArray(q.options_vi) ? q.options_vi : null;
        if (!optsEn || optsEn.length < 2 || optsEn.length > 4 || !optsEn.every((o) => typeof o === 'string' && o.trim())) {
          errors.push(`${label}.options_en must be an array of 2-4 non-empty strings`);
        }
        if (!optsVi || optsVi.length < 2 || optsVi.length > 4 || !optsVi.every((o) => typeof o === 'string' && o.trim())) {
          errors.push(`${label}.options_vi must be an array of 2-4 non-empty strings`);
        }
        if (optsEn && optsVi && optsEn.length !== optsVi.length) {
          errors.push(`${label}.options_en and options_vi must be the same length`);
        }
        const optionsLength = optsEn ? optsEn.length : (optsVi ? optsVi.length : null);
        if (!Number.isInteger(q.correct_index) || optionsLength === null
          || q.correct_index < 0 || q.correct_index >= optionsLength) {
          errors.push(`${label}.correct_index must be a valid index into options_en`);
        }
        if (q.answer !== undefined) {
          errors.push(`${label} must not have answer for type 'choice'`);
        }
      }

      questions.push({
        id: q.id,
        after_segment: q.after_segment,
        type: q.type,
        question_en: q.question_en,
        question_vi: q.question_vi,
        ...(q.options_en !== undefined ? { options_en: q.options_en } : {}),
        ...(q.options_vi !== undefined ? { options_vi: q.options_vi } : {}),
        ...(q.correct_index !== undefined ? { correct_index: q.correct_index } : {}),
        ...(q.answer !== undefined ? { answer: q.answer } : {}),
      });
    });
  }

  const video = {
    schema_version: src.schema_version,
    id: src.id,
    youtube_id: src.youtube_id,
    title_vi: src.title_vi,
    title_en: src.title_en,
    level: src.level,
    duration_s: src.duration_s,
    prepared_at: src.prepared_at,
    source: isPlainObject(src.source) ? { ...src.source } : src.source,
    segments,
    questions,
  };

  return { ok: errors.length === 0, errors, video };
}
