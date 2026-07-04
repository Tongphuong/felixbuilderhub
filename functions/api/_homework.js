// Pure helpers for homework validation and record building.
// No I/O — importable by tests and the admin endpoint.

/**
 * @param {string} sentences_text
 * @returns {{ ok: true, lines: Array<{id:string, text_en:string}> } | { ok: false, error_vi: string }}
 */
export function parseHomeworkLines(sentences_text) {
  const raw = String(sentences_text || '');
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length > 12) {
    return { ok: false, error_vi: 'Tối đa 12 câu.' };
  }
  const allowed = /^[a-zA-Z0-9 .,!?'"-]+$/;
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 200) {
      return { ok: false, error_vi: `Dòng ${i + 1} quá dài (tối đa 200 ký tự).` };
    }
    if (!allowed.test(line)) {
      return { ok: false, error_vi: `Dòng ${i + 1} chứa ký tự không hợp lệ.` };
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
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
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
 * @returns {{ ok: true, value: object } | { ok: false, error_vi: string }}
 */
export function validateHomeworkInput({ sentences_text, frame_text, frame_duration_s, note_vi }) {
  const sentencesResult = parseHomeworkLines(sentences_text);
  if (!sentencesResult.ok) return sentencesResult;

  const frameResult = parseFrameStems(frame_text);
  if (!frameResult.ok) return frameResult;

  if (sentencesResult.lines.length === 0 && frameResult.stems.length === 0) {
    return { ok: false, error_vi: 'Cần ít nhất một câu hoặc một khung thuyết trình.' };
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
    },
  };
}

/**
 * @param {object} validatedValue
 * @param {object|null} previousHomework
 * @returns {object}
 */
export function buildHomeworkRecord(validatedValue, previousHomework) {
  const { sentences, frame_stems, frame_duration_s, note_vi } = validatedValue;

  const homework = {
    schema_version: 1,
    updated_at: new Date().toISOString(),
    note_vi,
    sentences: sentences.map(s => ({ id: s.id, text_en: s.text_en, hint_vi: null })),
    frame: frame_stems.length
      ? { stems: frame_stems.map(f => ({ id: f.id, text_en: f.text_en, anchor_words: f.anchor_words })), duration_s: frame_duration_s }
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
