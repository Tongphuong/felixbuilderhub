-- Additive, local synthetic family extension. Core schema and value records stay unchanged.
CREATE TABLE family_accounts (
  id TEXT PRIMARY KEY CHECK(id LIKE 'synthetic-%'),
  label_vi TEXT NOT NULL,
  access_salt TEXT NOT NULL, access_hash TEXT NOT NULL,
  parent_salt TEXT NOT NULL, parent_hash TEXT NOT NULL,
  recovery_salt TEXT NOT NULL, recovery_hash TEXT NOT NULL,
  credential_version INTEGER NOT NULL DEFAULT 1 CHECK(credential_version >= 1)
);
CREATE TABLE child_profiles (
  child_id TEXT PRIMARY KEY REFERENCES children(id),
  level TEXT NOT NULL CHECK(level IN ('L0','L1','L2','L3','L4','L5')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
  learning_enabled INTEGER NOT NULL DEFAULT 0 CHECK(learning_enabled IN (0,1)),
  recording_allowed INTEGER NOT NULL DEFAULT 0 CHECK(recording_allowed IN (0,1)),
  CHECK(recording_allowed = 0 OR learning_enabled = 1)
);
CREATE TABLE family_receipts (
  family_id TEXT NOT NULL REFERENCES family_accounts(id),
  request_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  response_json TEXT NOT NULL,
  PRIMARY KEY(family_id, request_id)
);
CREATE TABLE family_audit (
  id INTEGER PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES family_accounts(id),
  action TEXT NOT NULL CHECK(action IN ('seeded','child_created','profile_updated','credentials_recovered')),
  child_id TEXT REFERENCES children(id),
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TRIGGER family_receipts_no_update BEFORE UPDATE ON family_receipts BEGIN SELECT RAISE(ABORT,'immutable_family_receipt'); END;
CREATE TRIGGER family_receipts_no_delete BEFORE DELETE ON family_receipts BEGIN SELECT RAISE(ABORT,'immutable_family_receipt'); END;
CREATE TRIGGER family_audit_no_update BEFORE UPDATE ON family_audit BEGIN SELECT RAISE(ABORT,'immutable_family_audit'); END;
CREATE TRIGGER family_audit_no_delete BEFORE DELETE ON family_audit BEGIN SELECT RAISE(ABORT,'immutable_family_audit'); END;
INSERT INTO r2l_meta(key,value) VALUES('family_schema_version','1');
