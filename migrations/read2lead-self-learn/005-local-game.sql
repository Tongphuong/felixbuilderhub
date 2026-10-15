-- Additive synthetic game data. No wallet, ledger, learning or legacy season mutations.
CREATE TABLE game_preferences (
  child_id TEXT PRIMARY KEY REFERENCES children(id),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  monster_json TEXT NOT NULL CHECK(json_valid(monster_json)),
  updated_at TEXT NOT NULL
);
CREATE TABLE game_imports (
  child_id TEXT PRIMARY KEY REFERENCES children(id),
  source_sha256 TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE game_receipts (
  child_id TEXT NOT NULL REFERENCES children(id),
  request_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  PRIMARY KEY(child_id,request_id)
);
CREATE TABLE game_audit (
  id INTEGER PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES children(id),
  action TEXT NOT NULL CHECK(action IN ('monster_selected','legacy_imported')),
  revision INTEGER NOT NULL CHECK(revision >= 0),
  source_sha256 TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TRIGGER game_preferences_no_delete BEFORE DELETE ON game_preferences BEGIN SELECT RAISE(ABORT,'preserve_game_preferences'); END;
CREATE TRIGGER game_imports_no_update BEFORE UPDATE ON game_imports BEGIN SELECT RAISE(ABORT,'immutable_game_import'); END;
CREATE TRIGGER game_imports_no_delete BEFORE DELETE ON game_imports BEGIN SELECT RAISE(ABORT,'immutable_game_import'); END;
CREATE TRIGGER game_receipts_no_update BEFORE UPDATE ON game_receipts BEGIN SELECT RAISE(ABORT,'immutable_game_receipt'); END;
CREATE TRIGGER game_receipts_no_delete BEFORE DELETE ON game_receipts BEGIN SELECT RAISE(ABORT,'immutable_game_receipt'); END;
CREATE TRIGGER game_audit_no_update BEFORE UPDATE ON game_audit BEGIN SELECT RAISE(ABORT,'immutable_game_audit'); END;
CREATE TRIGGER game_audit_no_delete BEFORE DELETE ON game_audit BEGIN SELECT RAISE(ABORT,'immutable_game_audit'); END;
INSERT INTO r2l_meta(key,value) VALUES('game_schema_version','1');
