-- Additive synthetic library extension; free reading never enters the reward/session ledger.
CREATE TABLE library_preferences (
  child_id TEXT PRIMARY KEY REFERENCES children(id),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  interest_ids_json TEXT NOT NULL CHECK(json_valid(interest_ids_json))
);
CREATE TABLE library_favorites (
  child_id TEXT NOT NULL REFERENCES children(id),
  lesson_id TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY(child_id,lesson_id)
);
CREATE TABLE library_readings (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES children(id),
  lesson_id TEXT NOT NULL,
  content_version TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  lesson_json TEXT NOT NULL CHECK(json_valid(lesson_json)),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  sentence_id TEXT NOT NULL,
  marked_finished INTEGER NOT NULL DEFAULT 0 CHECK(marked_finished IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX library_readings_child ON library_readings(child_id,updated_at DESC,id);
CREATE TABLE library_receipts (
  child_id TEXT NOT NULL REFERENCES children(id),
  request_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  PRIMARY KEY(child_id,request_id)
);
CREATE TABLE library_audit (
  id INTEGER PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES children(id),
  action TEXT NOT NULL CHECK(action IN ('interests_set','favorite_set','reading_opened','reading_updated')),
  entity_id TEXT,
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TRIGGER library_reading_pin_no_update BEFORE UPDATE OF child_id,lesson_id,content_version,content_sha256,lesson_json ON library_readings BEGIN SELECT RAISE(ABORT,'immutable_reading_pin'); END;
CREATE TRIGGER library_reading_no_delete BEFORE DELETE ON library_readings BEGIN SELECT RAISE(ABORT,'preserve_reading_history'); END;
CREATE TRIGGER library_receipts_no_update BEFORE UPDATE ON library_receipts BEGIN SELECT RAISE(ABORT,'immutable_library_receipt'); END;
CREATE TRIGGER library_receipts_no_delete BEFORE DELETE ON library_receipts BEGIN SELECT RAISE(ABORT,'immutable_library_receipt'); END;
CREATE TRIGGER library_audit_no_update BEFORE UPDATE ON library_audit BEGIN SELECT RAISE(ABORT,'immutable_library_audit'); END;
CREATE TRIGGER library_audit_no_delete BEFORE DELETE ON library_audit BEGIN SELECT RAISE(ABORT,'immutable_library_audit'); END;
INSERT INTO r2l_meta(key,value) VALUES('library_schema_version','1');
