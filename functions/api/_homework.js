// Pure helpers for homework validation and record building.
// No I/O — importable by tests, the admin endpoints, and the compiler.
//
// Schema v3 (2026-07-13): the stored homework record moved from
// sentences[]/frame/photo_talk (v1/v2) to a generic tasks[] array (read /
// present / story / build / picture / qa). THE PILOT IS LIVE (20 kids) on
// schema v2 in KV — normalizeHomeworkRecord() upgrades any stored version to
// the v3 shape IN MEMORY on read; nothing here ever rewrites a stored
// record. See _ops contract `homework-tasks-contract.md` for the spec of
// record.

export const HOMEWORK_PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const HOMEWORK_PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const EMPTY_HOMEWORK_ERROR_VI = 'Cần ít nhất một câu, một khung thuyết trình hoặc một ảnh bài tập.';

// ---------------------------------------------------------------------------
// English-text charset + URL/contact fence
// ---------------------------------------------------------------------------
//
// Base allowlist includes '/' (2026-07-13, Elon correction after a
// real-lesson probe): Phương's real lessons routinely carry "Yes/No, my
// friend is ___ because ___." and "He/She is kind when ___." — the old
// allowlist (inherited from pre-v3 parseHomeworkLines) had no slash and
// silently rejected both. This also fixes a pre-existing bug in
// parseHomeworkLines itself, not just the new task validators — one shared
// pattern, both call sites.
//
// '_' is additionally allowed ONLY where a ___ blank can legitimately live:
// present/qa stem text. Never loosen beyond this (no <, >, &, backtick,
// emoji) — the char class is intentionally an allowlist, not a denylist.
const ENGLISH_CHAR_CLASS = `a-zA-Z0-9 .,!?'":;()/-`;
const ENGLISH_STEM_CHAR_CLASS = `${ENGLISH_CHAR_CLASS}_`;
const ENGLISH_TEXT_PATTERN = new RegExp(`^[${ENGLISH_CHAR_CLASS}]+$`);
const ENGLISH_STEM_PATTERN = new RegExp(`^[${ENGLISH_STEM_CHAR_CLASS}]+$`);
const ENGLISH_CHAR_TEST = new RegExp(`[${ENGLISH_CHAR_CLASS}]`);
const ENGLISH_STEM_CHAR_TEST = new RegExp(`[${ENGLISH_STEM_CHAR_CLASS}]`);

// URL/contact fence (2026-07-13, Elon) — allowing '/' means a URL now passes
// the charset check. Homework English text must never carry a link or
// contact (V0 D7 layer-2 guardrail doctrine: no links anywhere Minny
// surfaces); a hostile pasted lesson or a rogue extractor draft could try to
// smuggle one past the charset gate now that '/' is legal. Deterministic,
// independent of the charset check, applied to every English field
// (including must_use/anchors single words, checked pre-strip so a mangled
// "httpevilcom" can't sneak through after alphanumeric normalization).
// The TLD allowlist this replaces (com|net|org|io|vn|co|xyz|ru|cn) let every
// other TLD straight through — "Go to evil.app today." validated and reached
// the kid's screen and TTS (Buffet, 2026-07-13). Match domain SHAPE instead:
// a label, a dot, then a 2+ letter tail. The {2,} tail is what keeps ordinary
// teacher English safe — "7 a.m.", "e.g.", "i.e.", "U.S.", "Mr. Nam" and
// "I have two cats." all have a 1-letter or space-separated tail and so do not
// match; "3.14" has no letter tail either.
const URL_OR_CONTACT_PATTERN = /:\/\/|www\.|\b[a-z0-9-]+\.[a-z]{2,24}\b|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const URL_ERROR_VI = 'Bài tập không được chứa đường link.';

/**
 * Validates one piece of teacher/model-authored English text: normalizes
 * quotes/dashes (normalizeTeacherLine), checks length, rejects any
 * URL/contact fragment, then checks charset. `allowUnderscore` is true only
 * for present/qa stem text (where the ___ blank lives). Reused by every
 * English field in every task type, and by parseHomeworkLines/
 * parseFrameStems (the legacy-shape parsers), so the charset + URL fence can
 * never drift between the old and new payload shapes.
 * @param {*} raw
 * @param {{allowUnderscore?: boolean, maxLength?: number}} [opts]
 * @returns {{ok:true, value:string}|{ok:false, reason:'empty'|'length'|'url'|'charset', badChar?:string}}
 */
export function validateEnglishText(raw, { allowUnderscore = false, maxLength = 200 } = {}) {
  const text = normalizeTeacherLine(raw);
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > maxLength) return { ok: false, reason: 'length' };
  if (URL_OR_CONTACT_PATTERN.test(text)) return { ok: false, reason: 'url' };
  const pattern = allowUnderscore ? ENGLISH_STEM_PATTERN : ENGLISH_TEXT_PATTERN;
  if (!pattern.test(text)) {
    const charTest = allowUnderscore ? ENGLISH_STEM_CHAR_TEST : ENGLISH_CHAR_TEST;
    const badChar = [...text].find((ch) => !charTest.test(ch));
    return { ok: false, reason: 'charset', badChar };
  }
  return { ok: true, value: text };
}

/**
 * Derives anchor words from stem text containing ___ blanks: strips the
 * blanks, splits on whitespace AND '/' (so "He/She", "Yes/No" become two
 * separate anchor words rather than one concatenated "heshe"/"yesno" token
 * that a kid's spoken answer could never match), lowercases, strips
 * non-alphanumerics, drops empties. anchor_words are DERIVED, never trusted
 * from caller input — reused everywhere a stem's blanks need anchor words:
 * present stems, qa card stems.
 * @param {string} textWithBlanks
 * @returns {string[]}
 */
export function deriveAnchorWords(textWithBlanks) {
  const withoutBlanks = String(textWithBlanks || '').replace(/___/g, ' ');
  const tokens = withoutBlanks.split(/[\s/]+/).filter(Boolean);
  return tokens.map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean);
}

/**
 * Normalizes a must_use/anchors word list: every raw entry may itself
 * contain multiple whitespace-separated words (a teacher typing "ice cream"
 * as one entry still yields two single-word anchors); every raw token is
 * fenced against URLs/links BEFORE the alphanumeric strip (a stripped URL
 * like "http://evil.com" would otherwise look like an innocuous
 * "httpevilcom" and slip past), then lowercased, stripped of
 * non-alphanumerics, deduped (first occurrence wins), and capped.
 * @param {*} raw
 * @param {number} maxCount
 * @returns {{ok:true, value:string[]}|{ok:false, error_vi:string}}
 */
export function normalizeWordList(raw, maxCount) {
  const entries = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const words = [];
  for (const entry of entries) {
    const tokens = String(entry ?? '').split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      if (URL_OR_CONTACT_PATTERN.test(token)) {
        return { ok: false, error_vi: URL_ERROR_VI };
      }
      const word = token.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (word && !seen.has(word)) {
        seen.add(word);
        words.push(word);
      }
    }
  }
  if (words.length > maxCount) {
    return { ok: false, error_vi: `Tối đa ${maxCount} từ khoá.` };
  }
  return { ok: true, value: words };
}

function clampDuration(raw, fallback = 60) {
  let d = Number(raw);
  if (!Number.isFinite(d) || !Number.isInteger(d)) d = fallback;
  return Math.max(10, Math.min(300, d));
}

// A caller-supplied id (task/item/stem/card/column) is trusted if it looks
// like a reasonable slug; otherwise a positional default is generated. The
// v3 tasks[] payload shape carries structured ids from the admin UI (unlike
// the old plain-text sentences_text/frame_text boxes, which never had ids to
// trust), but the extractor's draft tasks carry NO ids at all (an LLM JSON
// draft is plain text turned into strings/objects) — so every id must have a
// positional fallback.
function resolveId(raw, fallback) {
  return typeof raw === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(raw) ? raw : fallback;
}

// The extractor's draft returns stems/cards as plain strings (an LLM JSON
// draft), while a save-payload from the admin UI may send structured
// {id, text_en} objects. Every stem/item validator accepts both.
function textFromInput(raw, field = 'text_en') {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && typeof raw[field] === 'string') return raw[field];
  return '';
}

function englishTextError(v, contextLabel) {
  if (v.reason === 'url') return URL_ERROR_VI;
  if (v.reason === 'length') return `${contextLabel}: quá dài (tối đa 200 ký tự).`;
  if (v.reason === 'charset') return `${contextLabel}: có ký tự chưa hỗ trợ: "${v.badChar}". Chỉ nhận câu tiếng Anh.`;
  return `${contextLabel}: không được để trống.`;
}

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
    .replace(/ /g, ' ')
    .trim();
}

/**
 * @param {string} sentences_text
 * @returns {{ ok: true, lines: Array<{id:string, text_en:string}> } | { ok: false, error_vi: string }}
 */
export function parseHomeworkLines(sentences_text) {
  const raw = String(sentences_text || '');
  const lines = raw.split('\n').map((l) => normalizeTeacherLine(l)).filter(Boolean);
  if (lines.length > 12) {
    return { ok: false, error_vi: 'Tối đa 12 câu.' };
  }
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const v = validateEnglishText(line, { allowUnderscore: false });
    if (!v.ok) {
      if (v.reason === 'length') {
        return { ok: false, error_vi: `Dòng ${i + 1} quá dài (tối đa 200 ký tự).` };
      }
      if (v.reason === 'url') {
        return { ok: false, error_vi: URL_ERROR_VI };
      }
      // charset (or empty, which can't happen here since blank lines were
      // already filtered out above)
      if (line.includes('_')) {
        return { ok: false, error_vi: `Dòng ${i + 1} có chỗ trống ___ — câu có chỗ trống thì nhập vào ô "Khung thuyết trình" nhé.` };
      }
      return { ok: false, error_vi: `Dòng ${i + 1} có ký tự chưa hỗ trợ: "${v.badChar}". Ô này chỉ nhận câu tiếng Anh.` };
    }
    result.push({ id: `s${i + 1}`, text_en: v.value });
  }
  return { ok: true, lines: result };
}

/**
 * @param {string} frame_text
 * @returns {{ ok: true, stems: Array<{id:string, text_en:string, anchor_words:string[]}> } | { ok: false, error_vi: string }}
 */
export function parseFrameStems(frame_text) {
  const raw = String(frame_text || '');
  const lines = raw.split('\n').map((l) => normalizeTeacherLine(l).replace(/_{2,}/g, '___')).filter(Boolean);
  if (lines.length > 8) {
    return { ok: false, error_vi: 'Tối đa 8 dòng khung câu.' };
  }
  const stems = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 200) {
      return { ok: false, error_vi: `Dòng ${i + 1} quá dài (tối đa 200 ký tự).` };
    }
    if (URL_OR_CONTACT_PATTERN.test(line)) {
      return { ok: false, error_vi: URL_ERROR_VI };
    }
    if (!line.includes('___')) {
      return { ok: false, error_vi: `Dòng ${i + 1} không có chỗ trống (___).` };
    }
    if (!ENGLISH_STEM_PATTERN.test(line)) {
      const badChar = [...line].find((ch) => !ENGLISH_STEM_CHAR_TEST.test(ch));
      return { ok: false, error_vi: `Dòng ${i + 1} có ký tự chưa hỗ trợ: "${badChar}". Ô này chỉ nhận câu tiếng Anh.` };
    }
    const anchor_words = deriveAnchorWords(line);
    if (anchor_words.length === 0) {
      return { ok: false, error_vi: `Khung câu dòng ${i + 1} không có từ khoá nào ngoài chỗ trống.` };
    }
    stems.push({ id: `f${i + 1}`, text_en: line, anchor_words });
  }
  return { ok: true, stems };
}

// ---------------------------------------------------------------------------
// Schema v3 task validators
// ---------------------------------------------------------------------------

const TASK_TYPES = new Set(['read', 'present', 'story', 'build', 'picture', 'qa']);

function validateReadTask(taskRaw, id, index) {
  const label = `Nhiệm vụ ${index + 1}`;
  const itemsRaw = Array.isArray(taskRaw.items) ? taskRaw.items : [];
  if (!itemsRaw.length) return { ok: false, error_vi: `${label}: cần ít nhất 1 câu.` };
  if (itemsRaw.length > 12) return { ok: false, error_vi: `${label}: tối đa 12 câu.` };
  const items = [];
  for (let i = 0; i < itemsRaw.length; i++) {
    const v = validateEnglishText(textFromInput(itemsRaw[i]), { allowUnderscore: false });
    if (!v.ok) return { ok: false, error_vi: englishTextError(v, `${label}, câu ${i + 1}`) };
    const itemId = resolveId(itemsRaw[i]?.id, `s${i + 1}`);
    items.push({ id: itemId, text_en: v.value });
  }
  return { ok: true, value: { id, type: 'read', items } };
}

function validatePresentTask(taskRaw, id, index) {
  const label = `Nhiệm vụ ${index + 1}`;
  const stemsRaw = Array.isArray(taskRaw.stems) ? taskRaw.stems : [];
  if (!stemsRaw.length) return { ok: false, error_vi: `${label}: cần ít nhất 1 khung câu.` };
  if (stemsRaw.length > 8) return { ok: false, error_vi: `${label}: tối đa 8 khung câu.` };
  const stems = [];
  for (let i = 0; i < stemsRaw.length; i++) {
    const rawText = textFromInput(stemsRaw[i]).replace(/_{2,}/g, '___');
    const v = validateEnglishText(rawText, { allowUnderscore: true });
    if (!v.ok) return { ok: false, error_vi: englishTextError(v, `${label}, khung câu ${i + 1}`) };
    if (!v.value.includes('___')) return { ok: false, error_vi: `${label}, khung câu ${i + 1}: không có chỗ trống (___).` };
    const anchor_words = deriveAnchorWords(v.value);
    if (!anchor_words.length) return { ok: false, error_vi: `${label}, khung câu ${i + 1}: không có từ khoá nào ngoài chỗ trống.` };
    const stemId = resolveId(stemsRaw[i]?.id, `f${i + 1}`);
    stems.push({ id: stemId, text_en: v.value, anchor_words });
  }
  const duration_s = clampDuration(taskRaw.duration_s, 60);
  return { ok: true, value: { id, type: 'present', stems, duration_s } };
}

function validateStoryTask(taskRaw, id, index) {
  const label = `Nhiệm vụ ${index + 1}`;
  const promptV = validateEnglishText(taskRaw.prompt_en, { allowUnderscore: false });
  if (!promptV.ok) return { ok: false, error_vi: englishTextError(promptV, `${label}, câu chuyện`) };
  const prompt_vi = taskRaw.prompt_vi != null ? String(taskRaw.prompt_vi).trim().slice(0, 200) : '';
  const mustUseResult = normalizeWordList(taskRaw.must_use, 12);
  if (!mustUseResult.ok) return mustUseResult;
  const duration_s = clampDuration(taskRaw.duration_s, 90);
  const use_photo = Boolean(taskRaw.use_photo);
  return { ok: true, value: { id, type: 'story', prompt_en: promptV.value, prompt_vi, must_use: mustUseResult.value, duration_s, use_photo } };
}

function validateBuildTask(taskRaw, id, index) {
  const label = `Nhiệm vụ ${index + 1}`;
  const columnsRaw = Array.isArray(taskRaw.columns) ? taskRaw.columns : [];
  if (columnsRaw.length < 2 || columnsRaw.length > 4) {
    return { ok: false, error_vi: `${label}: cần 2-4 cột.` };
  }
  const columns = [];
  for (let i = 0; i < columnsRaw.length; i++) {
    const colRaw = columnsRaw[i] || {};
    const labelV = validateEnglishText(colRaw.label_en, { allowUnderscore: false });
    if (!labelV.ok) return { ok: false, error_vi: englishTextError(labelV, `${label}, cột ${i + 1}`) };
    const optionsRaw = Array.isArray(colRaw.options) ? colRaw.options : [];
    if (optionsRaw.length < 2 || optionsRaw.length > 8) {
      return { ok: false, error_vi: `${label}, cột ${i + 1}: cần 2-8 lựa chọn.` };
    }
    const options = [];
    for (let j = 0; j < optionsRaw.length; j++) {
      const optV = validateEnglishText(optionsRaw[j], { allowUnderscore: false });
      if (!optV.ok) return { ok: false, error_vi: englishTextError(optV, `${label}, cột ${i + 1}, lựa chọn ${j + 1}`) };
      options.push(optV.value);
    }
    const colId = resolveId(colRaw.id, `c${i + 1}`);
    columns.push({ id: colId, label_en: labelV.value, options });
  }
  let sentences_required = Number(taskRaw.sentences_required);
  if (!Number.isFinite(sentences_required) || !Number.isInteger(sentences_required)) sentences_required = 1;
  sentences_required = Math.max(1, Math.min(5, sentences_required));
  return { ok: true, value: { id, type: 'build', columns, sentences_required } };
}

function validatePictureTask(taskRaw, id, index, photo) {
  const label = `Nhiệm vụ ${index + 1}`;
  if (!photo) {
    return { ok: false, error_vi: `${label}: cần tải ảnh bài tập lên trước khi dùng nhiệm vụ xem ảnh.` };
  }
  const anchorsResult = normalizeWordList(taskRaw.anchors, 15);
  if (!anchorsResult.ok) return anchorsResult;
  const duration_s = clampDuration(taskRaw.duration_s, 60);
  return { ok: true, value: { id, type: 'picture', anchors: anchorsResult.value, duration_s } };
}

function validateQaTask(taskRaw, id, index) {
  const label = `Nhiệm vụ ${index + 1}`;
  const cardsRaw = Array.isArray(taskRaw.cards) ? taskRaw.cards : [];
  if (!cardsRaw.length) return { ok: false, error_vi: `${label}: cần ít nhất 1 câu hỏi.` };
  if (cardsRaw.length > 8) return { ok: false, error_vi: `${label}: tối đa 8 câu hỏi.` };
  const cards = [];
  for (let i = 0; i < cardsRaw.length; i++) {
    const cardRaw = cardsRaw[i] || {};
    const qV = validateEnglishText(cardRaw.question_en, { allowUnderscore: false });
    if (!qV.ok) return { ok: false, error_vi: englishTextError(qV, `${label}, câu hỏi ${i + 1}`) };
    const rawStemText = textFromInput(cardRaw.stem).replace(/_{2,}/g, '___');
    const stemV = validateEnglishText(rawStemText, { allowUnderscore: true });
    if (!stemV.ok) return { ok: false, error_vi: englishTextError(stemV, `${label}, khung trả lời ${i + 1}`) };
    if (!stemV.value.includes('___')) return { ok: false, error_vi: `${label}, khung trả lời ${i + 1}: không có chỗ trống (___).` };
    const anchor_words = deriveAnchorWords(stemV.value);
    if (!anchor_words.length) return { ok: false, error_vi: `${label}, khung trả lời ${i + 1}: không có từ khoá nào ngoài chỗ trống.` };
    const cardId = resolveId(cardRaw.id, `q${i + 1}`);
    cards.push({ id: cardId, question_en: qV.value, stem: { text_en: stemV.value, anchor_words } });
  }
  const duration_s = clampDuration(taskRaw.duration_s, 30);
  return { ok: true, value: { id, type: 'qa', cards, duration_s } };
}

/**
 * Validates ONE raw task object against its declared type. Exported (not
 * just used internally) because the extract endpoint validates draft tasks
 * one at a time, dropping invalid ones, rather than all-or-nothing like a
 * save payload.
 * @param {object} taskRaw
 * @param {number} index
 * @param {{photo?: object|null}} [ctx]
 * @returns {{ok:true, value:object}|{ok:false, error_vi:string}}
 */
export function validateTask(taskRaw, index, { photo = null } = {}) {
  if (!taskRaw || typeof taskRaw !== 'object' || Array.isArray(taskRaw)) {
    return { ok: false, error_vi: `Nhiệm vụ ${index + 1} không hợp lệ.` };
  }
  const type = String(taskRaw.type || '');
  if (!TASK_TYPES.has(type)) {
    return { ok: false, error_vi: `Nhiệm vụ ${index + 1} có loại không hợp lệ.` };
  }
  const id = resolveId(taskRaw.id, `t${index + 1}`);
  switch (type) {
    case 'read': return validateReadTask(taskRaw, id, index);
    case 'present': return validatePresentTask(taskRaw, id, index);
    case 'story': return validateStoryTask(taskRaw, id, index);
    case 'build': return validateBuildTask(taskRaw, id, index);
    case 'picture': return validatePictureTask(taskRaw, id, index, photo);
    case 'qa': return validateQaTask(taskRaw, id, index);
    default: return { ok: false, error_vi: `Nhiệm vụ ${index + 1} có loại không hợp lệ.` };
  }
}

/**
 * Validates the NEW v3 save-payload shape: { tasks: [...], note_vi, photo }.
 * All-or-nothing — the whole submission is rejected on the first invalid
 * task (unlike validateTask used standalone by the extractor, which drops
 * individual bad tasks from a draft).
 * @param {object} input
 * @returns {{ok:true, value:{tasks:object[], note_vi:string, photo:object|null}}|{ok:false, error_vi:string}}
 */
export function validateHomeworkTasksInput({ tasks, note_vi, photo, class_id } = {}) {
  const photoResult = validatePhotoRef(photo, class_id);
  if (!photoResult.ok) return photoResult;

  const tasksRaw = Array.isArray(tasks) ? tasks : [];
  if (tasksRaw.length > 8) {
    return { ok: false, error_vi: 'Tối đa 8 nhiệm vụ.' };
  }
  if (tasksRaw.length === 0 && !photoResult.value) {
    return { ok: false, error_vi: EMPTY_HOMEWORK_ERROR_VI };
  }

  const validated = [];
  for (let i = 0; i < tasksRaw.length; i++) {
    const result = validateTask(tasksRaw[i], i, { photo: photoResult.value });
    if (!result.ok) return result;
    validated.push(result.value);
  }

  const trimmedNote = String(note_vi || '').trim().slice(0, 300);
  return { ok: true, value: { tasks: validated, note_vi: trimmedNote, photo: photoResult.value } };
}

// ---------------------------------------------------------------------------
// Legacy (v1/v2) <-> tasks[] conversion — the ONE shared conversion, reused
// by (a) normalizeHomeworkRecord upgrading an already-stored v1/v2 KV
// record in memory, and (b) validateHomeworkInput adapting an OLD
// sentences_text/frame_text save payload into a v3 record. Keeping this in
// one place means "save a legacy payload today" and "read a legacy record
// saved yesterday" can never drift apart.
//
// Order is read -> present -> picture, reproducing today's exact step order
// (minny-speaking-context.js). Exported: homework-extract.js's vision-photo
// draft path (parsed sentence/frame lines, no photo) also needs it, rather
// than reimplementing the same read/present task shape a second time.
// ---------------------------------------------------------------------------
export function tasksFromLegacyShape({ sentences, frameStems, frameDurationS, photo }) {
  const tasks = [];
  if (sentences.length) {
    tasks.push({ id: 't_read', type: 'read', items: sentences.map((s) => ({ id: s.id, text_en: s.text_en })) });
  }
  if (frameStems.length) {
    tasks.push({
      id: 't_present',
      type: 'present',
      stems: frameStems.map((f) => ({ id: f.id, text_en: f.text_en, anchor_words: f.anchor_words })),
      duration_s: frameDurationS || 60,
    });
  }
  // Old photo_talk: a bare photo with no sentences and no frame. Anchors
  // stay empty on purpose — see the compiler's zero-anchor carve-out, which
  // keeps this exact case graded byte-identically to today.
  if (!sentences.length && !frameStems.length && photo) {
    tasks.push({ id: 't_picture', type: 'picture', anchors: [], duration_s: frameDurationS || 60 });
  }
  return tasks;
}

/**
 * Normalizes a stored homework record so ANY stored version (v1, v2, or v3)
 * reads as a v3-shaped object with tasks[]. Pure — no I/O, never writes
 * anything back to storage. Idempotent: handing it an already-v3 record
 * (Array.isArray(hw.tasks)) passes tasks through unchanged.
 *
 * CRITICAL: the pilot's 20 live kids have schema v2 records in KV. This is
 * the ONLY place that upgrades them, and it must do so byte-identically
 * (modulo the additive task_type field the compiler adds) — see
 * tests/minny-speaking.test.mjs for the deep-equal gate.
 * @param {object|null|undefined} hw
 * @returns {object|null}
 */
export function normalizeHomeworkRecord(hw) {
  if (!hw || typeof hw !== 'object') return null;
  const photo = hw.photo || null;
  const photo_talk = hw.photo_talk || null;

  if (Array.isArray(hw.tasks)) {
    return { ...hw, photo, photo_talk, tasks: hw.tasks };
  }

  const sentences = Array.isArray(hw.sentences)
    ? hw.sentences.map((s) => ({ id: s.id, text_en: s.text_en }))
    : [];
  const frameStemsRaw = hw.frame && Array.isArray(hw.frame.stems) ? hw.frame.stems : [];
  const frameStems = frameStemsRaw.map((f) => ({
    id: f.id,
    text_en: f.text_en,
    anchor_words: Array.isArray(f.anchor_words) ? f.anchor_words : [],
  }));
  // Present-task duration comes from the old frame block; the photo-only
  // (photo_talk) duration comes from its own block — these are two
  // different stored fields in v1/v2, only one of which is ever relevant
  // per record (a record is either frame-bearing or photo-only-bearing).
  const frameDurationS = frameStems.length
    ? (hw.frame?.duration_s || 60)
    : (photo_talk?.duration_s || 60);
  const tasks = tasksFromLegacyShape({ sentences, frameStems, frameDurationS, photo });

  return { ...hw, photo, photo_talk, tasks };
}

/**
 * @param {object} input
 * @param {string} input.sentences_text
 * @param {string} input.frame_text
 * @param {number|string} input.frame_duration_s
 * @param {string} input.note_vi
 * @param {object|null|undefined} input.photo
 * @param {string} input.class_id
 * @returns {{ ok: true, value: {tasks:object[], note_vi:string, photo:object|null} } | { ok: false, error_vi: string }}
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
    return { ok: false, error_vi: EMPTY_HOMEWORK_ERROR_VI };
  }

  let duration = Number(frame_duration_s);
  if (!Number.isFinite(duration) || !Number.isInteger(duration)) duration = 60;
  duration = Math.max(10, Math.min(300, duration));

  const trimmedNote = String(note_vi || '').trim().slice(0, 300);

  const tasks = tasksFromLegacyShape({
    sentences: sentencesResult.lines,
    frameStems: frameResult.stems,
    frameDurationS: duration,
    photo: photoResult.value,
  });

  return { ok: true, value: { tasks, note_vi: trimmedNote, photo: photoResult.value } };
}

/**
 * Writes the stored v3 record: { schema_version: 3, tasks: [...], ... }.
 * Both the NEW tasks[] save payload (validateHomeworkTasksInput) and the OLD
 * sentences_text/frame_text payload (validateHomeworkInput, adapted through
 * tasksFromLegacyShape) funnel through this one function.
 * @param {{tasks:object[], note_vi:string, photo:object|null}} validatedValue
 * @param {object|null} previousHomework
 * @returns {object}
 */
export function buildHomeworkRecord(validatedValue, previousHomework) {
  const { tasks, note_vi, photo } = validatedValue;

  const homework = {
    schema_version: 3,
    updated_at: new Date().toISOString(),
    note_vi,
    photo: photo || null,
    tasks: tasks || [],
    history: [],
  };

  if (previousHomework) {
    const { history: _prevHistory, ...rest } = previousHomework;
    const history = [rest, ...(previousHomework.history || [])].filter(Boolean).slice(0, 5);
    homework.history = history;
  }

  return homework;
}
