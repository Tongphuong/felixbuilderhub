-- Additive synthetic editor extension. No learner/session/value table changes.
CREATE TABLE editor_accounts (
  id TEXT PRIMARY KEY, display_name TEXT NOT NULL,
  access_salt TEXT NOT NULL, access_hash TEXT NOT NULL,
  credential_version INTEGER NOT NULL CHECK(credential_version >= 1),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1))
);
CREATE TABLE editor_documents (
  lesson_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  head_revision INTEGER NOT NULL CHECK(head_revision >= 1),
  published_revision INTEGER,
  workflow TEXT NOT NULL CHECK(workflow IN ('draft','in_review','changes_requested','qa_ready','qa_published')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(lesson_id,head_revision) REFERENCES editor_revisions(lesson_id,revision) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(lesson_id,published_revision) REFERENCES editor_revisions(lesson_id,revision) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE editor_revisions (
  lesson_id TEXT NOT NULL REFERENCES editor_documents(lesson_id) DEFERRABLE INITIALLY DEFERRED,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64 AND content_sha256 NOT GLOB '*[^a-f0-9]*'),
  lesson_json TEXT NOT NULL CHECK(json_valid(lesson_json)),
  created_by TEXT NOT NULL REFERENCES editor_accounts(id), created_at TEXT NOT NULL,
  PRIMARY KEY(lesson_id,revision), UNIQUE(lesson_id,revision,content_sha256)
);
CREATE TABLE editor_reviews (
  id TEXT PRIMARY KEY, lesson_id TEXT NOT NULL, content_revision INTEGER NOT NULL,
  content_sha256 TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('qa_ready','changes_requested')),
  review_json TEXT NOT NULL CHECK(json_valid(review_json)), note TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES editor_accounts(id), created_at TEXT NOT NULL,
  FOREIGN KEY(lesson_id,content_revision,content_sha256) REFERENCES editor_revisions(lesson_id,revision,content_sha256)
);
CREATE TABLE editor_blocks (
  lesson_id TEXT NOT NULL REFERENCES editor_documents(lesson_id),
  content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64 AND content_sha256 NOT GLOB '*[^a-f0-9]*'),
  blocked INTEGER NOT NULL CHECK(blocked IN (0,1)), revision INTEGER NOT NULL CHECK(revision >= 1),
  reason TEXT NOT NULL, updated_by TEXT NOT NULL REFERENCES editor_accounts(id), updated_at TEXT NOT NULL,
  PRIMARY KEY(lesson_id,content_sha256)
);
CREATE TABLE editor_receipts (
  editor_id TEXT NOT NULL REFERENCES editor_accounts(id), request_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL, response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  PRIMARY KEY(editor_id,request_id)
);
CREATE TABLE editor_audit (
  id INTEGER PRIMARY KEY, actor_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('account_seeded','access_changed','draft_saved','review_requested','reviewed','qa_published','quarantined','quarantine_released')),
  lesson_id TEXT, content_revision INTEGER, document_revision INTEGER,
  reason TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX editor_reviews_revision ON editor_reviews(lesson_id,content_revision,id);
CREATE INDEX editor_audit_lesson ON editor_audit(lesson_id,id);
CREATE TRIGGER editor_account_no_delete BEFORE DELETE ON editor_accounts BEGIN SELECT RAISE(ABORT,'preserve_editor_account'); END;
CREATE TRIGGER editor_document_no_delete BEFORE DELETE ON editor_documents BEGIN SELECT RAISE(ABORT,'preserve_editor_document'); END;
CREATE TRIGGER editor_revision_no_update BEFORE UPDATE ON editor_revisions BEGIN SELECT RAISE(ABORT,'immutable_editor_revision'); END;
CREATE TRIGGER editor_revision_no_delete BEFORE DELETE ON editor_revisions BEGIN SELECT RAISE(ABORT,'preserve_editor_revision'); END;
CREATE TRIGGER editor_review_no_update BEFORE UPDATE ON editor_reviews BEGIN SELECT RAISE(ABORT,'immutable_editor_review'); END;
CREATE TRIGGER editor_review_no_delete BEFORE DELETE ON editor_reviews BEGIN SELECT RAISE(ABORT,'preserve_editor_review'); END;
CREATE TRIGGER editor_receipt_no_update BEFORE UPDATE ON editor_receipts BEGIN SELECT RAISE(ABORT,'immutable_editor_receipt'); END;
CREATE TRIGGER editor_receipt_no_delete BEFORE DELETE ON editor_receipts BEGIN SELECT RAISE(ABORT,'preserve_editor_receipt'); END;
CREATE TRIGGER editor_audit_no_update BEFORE UPDATE ON editor_audit BEGIN SELECT RAISE(ABORT,'immutable_editor_audit'); END;
CREATE TRIGGER editor_audit_no_delete BEFORE DELETE ON editor_audit BEGIN SELECT RAISE(ABORT,'preserve_editor_audit'); END;
CREATE TRIGGER editor_block_identity_no_update BEFORE UPDATE OF lesson_id,content_sha256 ON editor_blocks BEGIN SELECT RAISE(ABORT,'immutable_editor_block_identity'); END;
CREATE TRIGGER editor_block_no_delete BEFORE DELETE ON editor_blocks BEGIN SELECT RAISE(ABORT,'preserve_editor_block'); END;
INSERT INTO r2l_meta(key,value) VALUES('editor_schema_version','1');
