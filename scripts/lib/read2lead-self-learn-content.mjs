/** Internal synthetic content adapter. Call within the caller's SQLite read/write transaction. */
import { createHash } from 'node:crypto';
import { canonical, validId } from '../../src/lib/read2lead/self-learn/session-contract.mjs';
class ContentError extends Error { constructor() { super('content_unavailable'); this.code = 'content_unavailable'; } }
const requireThat = ok => { if (!ok) throw new ContentError(); };
export const contentHash = lesson => createHash('sha256').update(canonical(lesson)).digest('hex');
function requireEditor(db) { requireThat(db.prepare("SELECT value FROM r2l_meta WHERE key='editor_schema_version'").get()?.value === '1'); }
export function availableContent(db, lessonId, hash) {
  requireEditor(db); requireThat(validId(lessonId) && typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash));
  return db.prepare('SELECT blocked FROM editor_blocks WHERE lesson_id=? AND content_sha256=?').get(lessonId, hash)?.blocked !== 1;
}
export function requireAvailableContent(db, lessonId, hash) { requireThat(availableContent(db, lessonId, hash)); }
export function requireCurrentPublication(db, lessonId, hash) {
  requireAvailableContent(db, lessonId, hash);
  const row = db.prepare('SELECT d.published_revision,r.content_sha256 FROM editor_documents d LEFT JOIN editor_revisions r ON r.lesson_id=d.lesson_id AND r.revision=d.published_revision WHERE d.lesson_id=?').get(lessonId);
  // Draft-only documents do not replace bootstrap lessons. A selected published revision cannot silently change during a new start.
  requireThat(row?.published_revision == null || row.content_sha256 === hash);
}
export function currentCatalogue(db, bootstrap) {
  requireEditor(db); const lessons = new Map(bootstrap.map(l => [l.id, structuredClone(l)]));
  const published = db.prepare('SELECT d.lesson_id,r.lesson_json,r.content_sha256 FROM editor_documents d LEFT JOIN editor_revisions r ON r.lesson_id=d.lesson_id AND r.revision=d.published_revision WHERE d.published_revision IS NOT NULL ORDER BY d.lesson_id').all();
  for (const row of published) {
    let lesson; try { lesson = JSON.parse(row.lesson_json); } catch { throw new ContentError(); }
    requireThat(lesson?.id === row.lesson_id && contentHash(lesson) === row.content_sha256);
    // Always replace first: a quarantined publication must not fall back to an older bootstrap copy.
    lessons.set(row.lesson_id, lesson);
  }
  return [...lessons.values()].filter(lesson => availableContent(db, lesson.id, contentHash(lesson)));
}
