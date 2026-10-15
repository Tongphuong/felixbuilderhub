/** Synthetic local library. Free-reading visits are self-reported, never learning or reward events. */
import { currentCatalogue, requireAvailableContent, contentHash } from './read2lead-self-learn-content.mjs';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { StoreError, syntheticDatabasePath } from './read2lead-self-learn-sqlite.mjs';
import { canonical, validId } from '../../src/lib/read2lead/self-learn/session-contract.mjs';
import { requireLevelCatalogue } from '../../functions/lib/read2lead/self-learn/level-policy.mjs';
import { validateLibraryInterests, librarySuggestions } from '../../functions/lib/read2lead/self-learn/library-policy.mjs';

import { publisherSuggestions } from '../../functions/lib/read2lead/self-learn/publisher-library-policy.mjs';
import { isPublisherRuntime } from './read2lead-publisher-runtime.mjs';
const READY = Symbol('validated-library');
const schema = readFileSync(new URL('../../migrations/read2lead-self-learn/003-local-library.sql', import.meta.url), 'utf8');
const tables = ['library_audit', 'library_favorites', 'library_preferences', 'library_readings', 'library_receipts'];
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const requireThat = (condition, code) => { if (!condition) throw new StoreError(code); };
const syntheticId = v => validId(v) && v.startsWith('synthetic-');
const revision = v => Number.isSafeInteger(v) && v >= 0 && v < Number.MAX_SAFE_INTEGER;
const timestamp = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
const sha = v => createHash('sha256').update(v).digest('hex');
function readingMetadata(row) {
  const lesson = JSON.parse(row.lesson_json);
  return { reading_id: row.id, child_id: row.child_id, lesson_id: row.lesson_id, title_en: lesson.title_en, level: lesson.level,
    content_version: row.content_version, content_sha256: row.content_sha256, revision: row.revision, sentence_id: row.sentence_id,
    marked_finished: row.marked_finished === 1, created_at: row.created_at, updated_at: row.updated_at,
    evidence_kind: 'self_reported_free_reading', rewards_awarded: false };
}

export class SyntheticLibraryStore {
  #db; #fault; #lessons; #groups; #editorContent; #publisher;
  static async open({ mode, root, catalogue, interests, fault = () => {}, editorContent = false, publisherRuntime = null } = {}) {
    requireThat(mode === 'synthetic-local', 'unsafe_library_mode');
    requireThat(typeof editorContent === 'boolean', 'invalid_content_mode');
    requireThat(publisherRuntime === null || isPublisherRuntime(publisherRuntime), 'invalid_publisher_runtime');
    // Copy before awaiting hashes. Failed validation cannot create or adopt a database extension.
    const candidate = structuredClone({ catalogue, interests });
    await requireLevelCatalogue(candidate.catalogue);
    const lessons = candidate.catalogue.lessons;
    requireThat(lessons.every(l => validId(l.id) && l.story.sentences.every(s => validId(s.id))), 'invalid_catalogue');
    const groups = validateLibraryInterests(candidate.interests, lessons);
    // Publisher packages validate their own authored themes. Unmapped themes receive
    // no interest boost; source order and same-level recommendations still apply.
    return new SyntheticLibraryStore(READY, { root, lessons, groups, fault, editorContent, publisherRuntime });
  }
  constructor(token, { root, lessons, groups, fault, editorContent, publisherRuntime } = {}) {
    requireThat(token === READY, 'use_library_factory');
    const path = syntheticDatabasePath(root);
    requireThat(existsSync(path), 'core_store_required');
    this.#db = new DatabaseSync(path); this.#fault = fault; this.#editorContent = editorContent; this.#publisher = publisherRuntime;
    this.#lessons = new Map(lessons.map(l => [l.id, l])); this.#groups = groups;
    try {
      requireThat(this.#db.prepare("SELECT value FROM r2l_meta WHERE key='family_schema_version'").get()?.value === '1', 'family_store_required');
      const check = () => {
        const version = this.#db.prepare("SELECT value FROM r2l_meta WHERE key='library_schema_version'").get()?.value;
        const present = this.#db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'library_%' ORDER BY name").all().map(r => r.name);
        requireThat(version === undefined || version === '1', 'unsupported_library_schema');
        requireThat(version === '1' ? canonical(present) === canonical(tables) : present.length === 0, 'unrecognized_library_schema');
        return version;
      };
      check();
      this.#db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      this.#db.exec('BEGIN IMMEDIATE');
      try { if (check() === undefined) this.#db.exec(schema); this.#db.exec('COMMIT'); }
      catch (error) { this.#db.exec('ROLLBACK'); throw error; }
    } catch (error) { this.#db.close(); throw error; }
  }
  close() { this.#db.close(); }
  #authorize(p) {
    requireThat(p?.active === true && ['child', 'parent'].includes(p.role) && syntheticId(p.familyId) && syntheticId(p.childId) && Number.isSafeInteger(p.credentialVersion), 'unauthorized');
    const account = this.#db.prepare('SELECT credential_version FROM family_accounts WHERE id=?').get(p.familyId);
    requireThat(account?.credential_version === p.credentialVersion, 'unauthorized');
    const child = this.#db.prepare('SELECT p.*,c.family_id FROM child_profiles p JOIN children c ON c.id=p.child_id WHERE p.child_id=?').get(p.childId);
    requireThat(child?.family_id === p.familyId, 'wrong_child');
    requireThat(child.archived === 0 && child.learning_enabled === 1, 'child_access_disabled');
    return child;
  }
  #read(principal, fn) {
    // All permission and private view queries share one SQLite snapshot.
    this.#db.exec('BEGIN');
    try { const result = fn(this.#authorize(principal)); this.#db.exec('COMMIT'); return result; }
    catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  #transaction(fn) {
    this.#fault('library_before_write_lock');
    let committed = false; this.#db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.#fault('library_before_commit'); this.#db.exec('COMMIT'); committed = true; this.#fault('library_after_commit'); return result; }
    catch (error) { if (!committed) this.#db.exec('ROLLBACK'); throw error; }
  }
  #operation(principal, requestId, payload, fn, checkReplay = () => {}) {
    requireThat(validId(requestId), 'invalid_request');
    const digest = sha(canonical(payload));
    return this.#transaction(() => {
      this.#authorize(principal); // Current authority before replay as well as every new write.
      const previous = this.#db.prepare('SELECT payload_sha256,response_json FROM library_receipts WHERE child_id=? AND request_id=?').get(principal.childId, requestId);
      if (previous) { requireThat(previous.payload_sha256 === digest, 'request_conflict'); const result = JSON.parse(previous.response_json); checkReplay(result); return { ...result, replayed: true }; }
      const result = { ...fn(), replayed: false };
      this.#db.prepare('INSERT INTO library_receipts VALUES(?,?,?,?)').run(principal.childId, requestId, digest, JSON.stringify(result));
      this.#fault('library_receipt_inserted'); return result;
    });
  }
  #catalogue() { if (this.#publisher) return this.#publisher.catalogue(); return this.#editorContent ? currentCatalogue(this.#db, [...this.#lessons.values()]) : [...this.#lessons.values()]; }
  #available(reading) { if (!this.#publisher && /^1\.2\.[1-9][0-9]*$/.test(reading.content_version)) requireThat(false, 'content_unavailable'); if (this.#publisher?.owns(reading.lesson_id)) return this.#publisher.assertAvailable(reading.lesson_id, reading.content_sha256); if (this.#editorContent) requireAvailableContent(this.#db, reading.lesson_id, reading.content_sha256); }
  /** Private content selection; callers must project child-safe cards/story fields. */
  catalogue(principal) { return this.#read(principal, () => structuredClone(this.#catalogue())); }
  #preferences(childId) {
    const row = this.#db.prepare('SELECT revision,interest_ids_json FROM library_preferences WHERE child_id=?').get(childId);
    return { revision: row?.revision ?? 0, interest_ids: row ? JSON.parse(row.interest_ids_json) : [] };
  }
  #updatePreferences(childId, expected, interestIds) {
    const current = this.#preferences(childId);
    requireThat(current.revision === expected, 'stale_revision');
    if (expected === 0) this.#db.prepare('INSERT INTO library_preferences VALUES(?,1,?)').run(childId, JSON.stringify(interestIds));
    else {
      const changed = this.#db.prepare('UPDATE library_preferences SET revision=revision+1,interest_ids_json=? WHERE child_id=? AND revision=?').run(JSON.stringify(interestIds), childId, expected);
      requireThat(Number(changed.changes) === 1, 'stale_revision');
    }
    this.#fault('library_preferences_updated'); return this.#preferences(childId);
  }
  #audit(childId, action, entityId, rev, now) {
    this.#db.prepare('INSERT INTO library_audit(child_id,action,entity_id,revision,created_at) VALUES(?,?,?,?,?)').run(childId, action, entityId, rev, now);
    this.#fault('library_audit_inserted');
  }
  setInterests(principal, data, now) {
    this.#authorize(principal);
    requireThat(exact(data, ['request_id', 'expected_revision', 'interest_ids']) && revision(data.expected_revision) && Array.isArray(data.interest_ids) && data.interest_ids.length <= 3 && new Set(data.interest_ids).size === data.interest_ids.length && data.interest_ids.every(id => this.#groups.some(g => g.id === id)) && timestamp(now), 'invalid_request');
    return this.#operation(principal, data.request_id, { operation: 'interests_set', ...data }, () => {
      const preferences = this.#updatePreferences(principal.childId, data.expected_revision, [...data.interest_ids]);
      this.#audit(principal.childId, 'interests_set', null, preferences.revision, now);
      return { ok: true, preferences };
    });
  }
  setFavorite(principal, data, now) {
    this.#authorize(principal);
    requireThat(exact(data, ['request_id', 'expected_revision', 'lesson_id', 'favorite']) && revision(data.expected_revision) && validId(data.lesson_id) && typeof data.favorite === 'boolean' && timestamp(now), 'invalid_request');
    return this.#operation(principal, data.request_id, { operation: 'favorite_set', ...data }, () => {
      // Removing a favorite remains possible after content leaves the available catalogue.
      requireThat(!data.favorite || this.#catalogue().some(l => l.id === data.lesson_id), 'content_unavailable');
      const current = this.#preferences(principal.childId), preferences = this.#updatePreferences(principal.childId, data.expected_revision, current.interest_ids);
      if (data.favorite) this.#db.prepare('INSERT INTO library_favorites VALUES(?,?,?) ON CONFLICT(child_id,lesson_id) DO NOTHING').run(principal.childId, data.lesson_id, now);
      else this.#db.prepare('DELETE FROM library_favorites WHERE child_id=? AND lesson_id=?').run(principal.childId, data.lesson_id);
      this.#fault('library_favorite_updated'); this.#audit(principal.childId, 'favorite_set', data.lesson_id, preferences.revision, now);
      return { ok: true, preferences, lesson_id: data.lesson_id, favorite: data.favorite };
    });
  }
  #reading(childId, readingId) {
    requireThat(validId(readingId), 'invalid_request');
    const row = this.#db.prepare('SELECT * FROM library_readings WHERE id=? AND child_id=?').get(readingId, childId);
    requireThat(row, 'reading_not_found'); return row;
  }
  openReading(principal, data, now) {
    this.#authorize(principal);
    requireThat(exact(data, ['request_id', 'lesson_id']) && validId(data.lesson_id) && timestamp(now), 'invalid_request');
    return this.#operation(principal, data.request_id, { operation: 'reading_opened', ...data }, () => {
      const lesson = this.#catalogue().find(l => l.id === data.lesson_id); requireThat(lesson, 'content_unavailable');
      const id = 'reading-' + sha(canonical([principal.childId, data.request_id]));
      this.#db.prepare('INSERT INTO library_readings(id,child_id,lesson_id,content_version,content_sha256,lesson_json,sentence_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(id, principal.childId, lesson.id, lesson.version, contentHash(lesson), JSON.stringify(lesson), lesson.story.sentences[0].id, now, now);
      this.#fault('library_reading_inserted'); this.#audit(principal.childId, 'reading_opened', id, 0, now);
      return { ok: true, reading: readingMetadata(this.#reading(principal.childId, id)) };
    }, result => this.#available(result.reading));
  }
  updateReading(principal, data, now) {
    this.#authorize(principal);
    requireThat(exact(data, ['request_id', 'reading_id', 'expected_revision', 'sentence_id', 'marked_finished']) && validId(data.reading_id) && revision(data.expected_revision) && validId(data.sentence_id) && typeof data.marked_finished === 'boolean' && timestamp(now), 'invalid_request');
    return this.#operation(principal, data.request_id, { operation: 'reading_updated', ...data }, () => {
      const row = this.#reading(principal.childId, data.reading_id), lesson = JSON.parse(row.lesson_json); this.#available(row);
      requireThat(row.revision === data.expected_revision, 'stale_revision');
      requireThat(row.marked_finished === 0, 'reading_finished');
      requireThat(lesson.story.sentences.some(s => s.id === data.sentence_id), 'invalid_request');
      const changed = this.#db.prepare('UPDATE library_readings SET revision=revision+1,sentence_id=?,marked_finished=?,updated_at=? WHERE id=? AND child_id=? AND revision=?')
        .run(data.sentence_id, Number(data.marked_finished), now, row.id, principal.childId, data.expected_revision);
      requireThat(Number(changed.changes) === 1, 'stale_revision');
      this.#fault('library_reading_updated'); this.#audit(principal.childId, 'reading_updated', row.id, row.revision + 1, now);
      return { ok: true, reading: readingMetadata(this.#reading(principal.childId, row.id)) };
    }, result => this.#available(result.reading));
  }
  reading(principal, readingId) {
    // Private domain record; HTTP must project story-only fields, never serialize lesson keys.
    return this.#read(principal, () => { const row = this.#reading(principal.childId, readingId); this.#available(row); return { reading: readingMetadata(row), lesson: JSON.parse(row.lesson_json) }; });
  }
  /** Stable creation order keeps bookmark updates from moving rows between history pages. */
  historyPage(principal, before = null) {
    return this.#read(principal, () => {
      requireThat(before === null || validId(before), 'invalid_request');
      if (before !== null) requireThat(this.#db.prepare('SELECT 1 FROM library_readings WHERE id=? AND child_id=?').get(before, principal.childId), 'invalid_request');
      const rows = this.#db.prepare('SELECT * FROM library_readings WHERE child_id=?' +
        (before === null ? '' : ' AND rowid < (SELECT rowid FROM library_readings WHERE id=? AND child_id=?)') + ' ORDER BY rowid DESC LIMIT 21')
        .all(...(before === null ? [principal.childId] : [principal.childId, before, principal.childId]));
      const entries = rows.slice(0, 20).map(readingMetadata);
      return { entries, next_before: rows.length > 20 ? entries.at(-1).reading_id : null };
    });
  }
  view(principal) {
    return this.#read(principal, child => {
      const favorites = this.#db.prepare('SELECT lesson_id,added_at FROM library_favorites WHERE child_id=? ORDER BY added_at DESC,lesson_id').all(principal.childId).map(r => ({ ...r }));
      const history = this.#db.prepare('SELECT * FROM library_readings WHERE child_id=? ORDER BY updated_at DESC,id LIMIT 100').all(principal.childId).map(readingMetadata);
      const seenIds = this.#db.prepare("SELECT lesson_id FROM library_readings WHERE child_id=? UNION SELECT json_extract(record_json,'$.session.lesson_id') FROM sessions WHERE child_id=?").all(principal.childId, principal.childId).map(r => r.lesson_id);
      const preferences = this.#preferences(principal.childId);
      const suggestionInput={lessons:this.#catalogue(),groups:this.#groups,level:child.level,interestIds:preferences.interest_ids,favoriteIds:favorites.map(f=>f.lesson_id),seenIds};
      let suggestions;
      if(this.#publisher){
        // Query all source encounters, not only the 100 rows displayed in history.
        // No raw response, learner transcript or audio enters recommendation metadata.
        const readings=this.#db.prepare(`SELECT id,lesson_id,content_version AS version,content_sha256 AS hash,
          json_extract(lesson_json,'$.source.source_id') AS source_id,json_extract(lesson_json,'$.level') AS level,
          CASE WHEN marked_finished=1 THEN 'complete' ELSE 'active' END AS status,updated_at FROM library_readings WHERE child_id=?`).all(principal.childId);
        const sessions=this.#db.prepare(`SELECT id,json_extract(record_json,'$.session.lesson_id') AS lesson_id,
          json_extract(record_json,'$.lesson.version') AS version,json_extract(record_json,'$.session.content_sha256') AS hash,
          json_extract(record_json,'$.lesson.source.source_id') AS source_id,json_extract(record_json,'$.lesson.level') AS level,
          json_extract(record_json,'$.session.status') AS status,json_extract(record_json,'$.session.updated_at') AS updated_at FROM sessions WHERE child_id=?`).all(principal.childId);
        const metadata=rows=>rows.filter(row=>this.#publisher.owns(row.lesson_id)).map(row=>{
          let available=true;try{this.#publisher.assertAvailable(row.lesson_id,row.hash);}catch(error){if(error.code!=='content_unavailable')throw error;available=false;}
          const {hash,...safe}=row;return{...safe,available};
        });
        suggestions=publisherSuggestions({...suggestionInput,readings:metadata(readings),sessions:metadata(sessions)});
      }else suggestions=librarySuggestions(suggestionInput);
      return { child_id: principal.childId, level: child.level, preferences,
        groups: this.#groups.map(g => ({ id: g.id, label_vi: g.label_vi })), favorites, reading_history: history,
        suggestions,
        automatic_mastery: false, automatic_promotion: false, real_rewards: false };
    });
  }
  audit(principal) { return this.#read(principal, () => this.#db.prepare('SELECT id,action,entity_id,revision,created_at FROM library_audit WHERE child_id=? ORDER BY id').all(principal.childId).map(r => ({ ...r }))); }
}
