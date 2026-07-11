// Pure helpers for homework validation and record building.
// No I/O — importable by tests and the admin endpoint.

export const HOMEWORK_PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const HOMEWORK_PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * Validates a photo descriptor (already uploaded to R2 by the admin
 * photo endpoint) referenced from the homework JSON. Pure — no I/O.
 * @param {object|null|undefined} photo
 * @param {string} class_id
 * @returns {{ ok: true, value: object|null } | { ok: false, error_vi: string }}
 */
export function validatePhotoRef(photo, class_id) {
  if (photo === null || photo === undefined) return { ok: true, value: null };
  if (typeof photo !== 'object' || Array.isArray(photo)) {
    return { ok: false, error_vi: 'Ảnh bài tập không hợp lệ.' };
  }
  const id = String(photo.id || '');
  if (!/^hp_[a-z0-9]{12}$/.test(id)) {
    return { ok: false, error_vi: 'Ảnh bài tập không hợp lệ.' };
  }
  const contentType = String(photo.content_type || '');
  const ext = HOMEWORK_PHOTO_TYPES[contentType];
  if (!ext) {
    return { ok: false, error_vi: 'Ảnh phải là JPEG, PNG hoặc WebP.' };
  }
  const classSegment = String(class_id || '');
  if (!/^[a-zA-Z0-9_-]+$/.test(classSegment)) {
    return { ok: false, error_vi: 'Ảnh bài tập không hợp lệ.' };
  }
  const expectedKey = `homework/${classSegment}/${id}.${ext}`;
  if (String(photo.r2_key || '') !== expectedKey) {
    return { ok: false, error_vi: 'Ảnh bài tập không hợp lệ.' };
  }
  const size = Number(photo.size);
  if (!Number.isInteger(size) || size <= 0 || size > HOMEWORK_PHOTO_MAX_BYTES) {
    return { ok: false, error_vi: 'Ảnh tối đa 8MB.' };
  }
  return { ok: true, value: { id, r2_key: expectedKey, content_type: contentType, size } };
}

/**
 * Normalizes a stored homework record so schema v1 records (no photo
 * field) read identically to v2 everywhere. Pure — no I/O.
 * @param {object|null|undefined} hw
 * @returns {object|null}
 */
export function normalizeHomeworkRecord(hw) {
  if (!hw || typeof hw !== 'object') return null;
  return { ...hw, photo: hw.photo || null, photo_talk: hw.photo_talk || null };
}

/**
 * Real teacher input arrives with curly quotes, long dashes, ellipses and
 * non-breaking spaces (Word/Zalo/slides). Normalize to the plain forms the
 * kid page, TTS and Azure grading expect instead of rejecting them.
 * @param {string} line
 * @returns {string}
 */
export function normalizeTeacherLine(line) {
  return String(line || '')
    .replace(/[“”„«»]/g, '"')
    .replace(/[‘’‚]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .trim();
}

/**
 * @param {string} sentences_text
 * @returns {{ ok: true, lines: Array<{id:string, text_en:string}> } | { ok: false, error_vi: string }}
 */
export function parseHomeworkLines(sentences_text) {
  const raw = String(sentences_text || '');
  const lines = raw.split('\n').map(l => normalizeTeacherLine(l)).filter(Boolean);
  if (lines.length > 12) {
    return { ok: false, error_vi: 'Tối đa 12 câu.' };
  }
  const allowed = /^[a-zA-Z0-9 .,!?'":;()-]+$/;
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 200) {
      return { ok: false, error_vi: `Dòng ${i + 1} quá dài (tối đa 200 ký tự).` };
    }
    if (!allowed.test(line)) {
      if (line.includes('_')) {
        return { ok: false, error_vi: `Dòng ${i + 1} có chỗ trống ___ — câu có chỗ trống thì nhập vào ô "Khung thuyết trình" nhé.` };
      }
      const bad = [...line].find(ch => !/[a-zA-Z0-9 .,!?'":;()-]/.test(ch));
      return { ok: false, error_vi: `Dòng ${i + 1} có ký tự chưa hỗ trợ: "${bad}". Ô này chỉ nhận câu tiếng Anh.` };
    }
    result.push({ id: `s${i + 1}`, text_en: line });
  }
  return { ok: true, lines: result };
}

/**
 * @param {string} frame_text
 * @returns {{ ok: true, stems: Array<{id:string, text_en:string, anchor_words:string[]}> } | { ok: false, error_vi: string }}
 */
export function parseFrameStems(frame_text) {
  const raw = String(frame_text || '');
  const lines = raw.split('\n').map(l => normalizeTeacherLine(l).replace(/_{2,}/g, '___')).filter(Boolean);
  if (lines.length > 8) {
    return { ok: false, error_vi: 'Tối đa 8 dòng khung câu.' };
  }
  const stems = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 200) {
      return { ok: false, error_vi: `Dòng ${i + 1} quá dài (tối đa 200 ký tự).` };
    }
    if (!line.includes('___')) {
      return { ok: false, error_vi: `Dòng ${i + 1} không có chỗ trống (___).` };
    }
    // Derive anchor words: remove blanks, split, lowercased, strip punctuation
    const withoutBlanks = line.replace(/___/g, ' ');
    const tokens = withoutBlanks.split(/\s+/).filter(Boolean);
    const anchor_words = tokens.map(t => t.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean);
    if (anchor_words.length === 0) {
      return { ok: false, error_vi: `Khung câu dòng ${i + 1} không có từ khoá nào ngoài chỗ trống.` };
    }
    stems.push({ id: `f${i + 1}`, text_en: line, anchor_words });
  }
  return { ok: true, stems };
}

/**
 * @param {object} input
 * @param {string} input.sentences_text
 * @param {string} input.frame_text
 * @param {number|string} input.frame_duration_s
 * @param {string} input.note_vi
 * @param {object|null|undefined} input.photo
 * @param {string} input.class_id
 * @returns {{ ok: true, value: object } | { ok: false, error_vi: string }}
 */
export function validateHomeworkInput({ sentences_text, frame_text, frame_duration_s, note_vi, photo, class_id }) {
  const sentencesResult = parseHomeworkLines(sentences_text);
  if (!sentencesResult.ok) return sentencesResult;

  const frameResult = parseFrameStems(frame_text);
  if (!frameResult.ok) return frameResult;

  const photoResult = validatePhotoRef(photo, class_id);
  if (!photoResult.ok) return photoResult;

  // A photo can be the whole homework (photo-only → look-and-speak step).
  if (sentencesResult.lines.length === 0 && frameResult.stems.length === 0 && !photoResult.value) {
    return { ok: false, error_vi: 'Cần ít nhất một câu, một khung thuyết trình hoặc một ảnh bài tập.' };
  }

  let duration = Number(frame_duration_s);
  if (!Number.isFinite(duration) || !Number.isInteger(duration)) duration = 60;
  duration = Math.max(10, Math.min(300, duration));

  const trimmedNote = String(note_vi || '').trim().slice(0, 300);

  return {
    ok: true,
    value: {
      sentences: sentencesResult.lines,
      frame_stems: frameResult.stems,
      frame_duration_s: duration,
      note_vi: trimmedNote,
      photo: photoResult.value,
    },
  };
}

/**
 * @param {object} validatedValue
 * @param {object|null} previousHomework
 * @returns {object}
 */
export function buildHomeworkRecord(validatedValue, previousHomework) {
  const { sentences, frame_stems, frame_duration_s, note_vi, photo } = validatedValue;

  const homework = {
    schema_version: 2,
    updated_at: new Date().toISOString(),
    note_vi,
    sentences: sentences.map(s => ({ id: s.id, text_en: s.text_en, hint_vi: null })),
    frame: frame_stems.length
      ? { stems: frame_stems.map(f => ({ id: f.id, text_en: f.text_en, anchor_words: f.anchor_words })), duration_s: frame_duration_s }
      : null,
    photo: photo || null,
    photo_talk: (!sentences.length && !frame_stems.length && photo)
      ? { duration_s: frame_duration_s }
      : null,
    history: [],
  };

  if (previousHomework) {
    const { history: _prevHistory, ...rest } = previousHomework;
    const history = [rest, ...(previousHomework.history || [])].filter(Boolean).slice(0, 5);
    homework.history = history;
  }

  return homework;
}
