-- Additive synthetic goals only. No wallet/ledger/learning mutations.
CREATE TABLE gift_goals (
  child_id TEXT PRIMARY KEY REFERENCES children(id),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  gift_id TEXT,
  quoted_version TEXT,
  updated_at TEXT NOT NULL,
  CHECK((gift_id IS NULL AND quoted_version IS NULL) OR (gift_id IS NOT NULL AND quoted_version IS NOT NULL)),
  FOREIGN KEY(gift_id,quoted_version) REFERENCES gifts(id,version)
);
CREATE TABLE gift_goal_receipts (
  child_id TEXT NOT NULL REFERENCES children(id),
  request_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  PRIMARY KEY(child_id,request_id)
);
CREATE TABLE gift_goal_audit (
  id INTEGER PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES children(id),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  goal_json TEXT NOT NULL CHECK(json_valid(goal_json)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TRIGGER gift_goals_no_delete BEFORE DELETE ON gift_goals BEGIN SELECT RAISE(ABORT,'preserve_gift_goal'); END;
CREATE TRIGGER gift_goal_receipts_no_update BEFORE UPDATE ON gift_goal_receipts BEGIN SELECT RAISE(ABORT,'immutable_gift_goal_receipt'); END;
CREATE TRIGGER gift_goal_receipts_no_delete BEFORE DELETE ON gift_goal_receipts BEGIN SELECT RAISE(ABORT,'immutable_gift_goal_receipt'); END;
CREATE TRIGGER gift_goal_audit_no_update BEFORE UPDATE ON gift_goal_audit BEGIN SELECT RAISE(ABORT,'immutable_gift_goal_audit'); END;
CREATE TRIGGER gift_goal_audit_no_delete BEFORE DELETE ON gift_goal_audit BEGIN SELECT RAISE(ABORT,'immutable_gift_goal_audit'); END;
INSERT INTO r2l_meta(key,value) VALUES('gift_goal_schema_version','1');
