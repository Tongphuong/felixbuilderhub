-- Synthetic local SQLite proof only. Never execute against an existing product database.
BEGIN IMMEDIATE;
PRAGMA application_id = 0x52324c31;
CREATE TABLE IF NOT EXISTS r2l_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
INSERT OR IGNORE INTO r2l_meta VALUES ('environment', 'synthetic'), ('schema_version', '1');
CREATE TABLE IF NOT EXISTS children (
  id TEXT PRIMARY KEY CHECK(id LIKE 'synthetic-%'),
  family_id TEXT NOT NULL CHECK(family_id LIKE 'synthetic-%'), display_name TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS wallets (
  child_id TEXT PRIMARY KEY REFERENCES children(id), balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0)
) STRICT;
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, child_id TEXT NOT NULL REFERENCES children(id), revision INTEGER NOT NULL CHECK(revision >= 0), record_json TEXT NOT NULL CHECK(json_valid(record_json))
) STRICT;
CREATE TABLE IF NOT EXISTS receipts (
  actor_scope TEXT NOT NULL, request_id TEXT NOT NULL, payload TEXT NOT NULL, response TEXT NOT NULL CHECK(json_valid(response)), PRIMARY KEY(actor_scope, request_id)
) STRICT;
CREATE TABLE IF NOT EXISTS gifts (
  id TEXT NOT NULL, version TEXT NOT NULL, title TEXT NOT NULL, price INTEGER NOT NULL CHECK(price BETWEEN 1 AND 1000000), available INTEGER NOT NULL CHECK(available IN(0,1)), PRIMARY KEY(id,version)
) STRICT;
CREATE TABLE IF NOT EXISTS catalog (
  gift_id TEXT PRIMARY KEY, version TEXT NOT NULL, FOREIGN KEY(gift_id,version) REFERENCES gifts(id,version)
) STRICT;
CREATE TABLE IF NOT EXISTS ledger (
  id TEXT PRIMARY KEY, child_id TEXT NOT NULL REFERENCES children(id), delta INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN('credit','debit','refund')), reference TEXT NOT NULL, created_at TEXT NOT NULL,
  CHECK((kind='debit' AND delta<0) OR (kind IN('credit','refund') AND delta>0)), UNIQUE(child_id,kind,reference)
) STRICT;
CREATE TABLE IF NOT EXISTS redemptions (
  id TEXT PRIMARY KEY, child_id TEXT NOT NULL REFERENCES children(id), gift_id TEXT NOT NULL, gift_version TEXT NOT NULL,
  price INTEGER NOT NULL CHECK(price>0), status TEXT NOT NULL CHECK(status IN('requested','preparing','delivered','rejected','refunded')),
  debit_id TEXT NOT NULL UNIQUE REFERENCES ledger(id) DEFERRABLE INITIALLY DEFERRED,
  refund_id TEXT UNIQUE REFERENCES ledger(id) DEFERRABLE INITIALLY DEFERRED,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(gift_id,gift_version) REFERENCES gifts(id,version), CHECK(status!='refunded' OR refund_id IS NOT NULL)
) STRICT;
CREATE TABLE IF NOT EXISTS redemption_audit (
  id INTEGER PRIMARY KEY, redemption_id TEXT NOT NULL REFERENCES redemptions(id), from_status TEXT, to_status TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER IF NOT EXISTS ledger_debit_guard BEFORE INSERT ON ledger WHEN NEW.kind='debit' BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM wallets WHERE child_id=NEW.child_id AND balance+NEW.delta>=0) THEN RAISE(ABORT,'insufficient_funds') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM redemptions WHERE id=NEW.reference AND child_id=NEW.child_id AND debit_id=NEW.id AND price=-NEW.delta AND status='requested') THEN RAISE(ABORT,'debit_order_mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS ledger_refund_guard BEFORE INSERT ON ledger WHEN NEW.kind='refund' BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM ledger d JOIN redemptions r ON r.debit_id=d.id WHERE d.id=NEW.reference AND d.kind='debit' AND d.child_id=NEW.child_id AND NEW.delta=-d.delta AND r.status='rejected' AND r.refund_id=NEW.id) THEN RAISE(ABORT,'refund_debit_mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS ledger_post AFTER INSERT ON ledger BEGIN
  UPDATE wallets SET balance=balance+NEW.delta WHERE child_id=NEW.child_id;
  SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'wallet_missing') END;
END;
CREATE TRIGGER IF NOT EXISTS ledger_immutable_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT,'immutable_ledger'); END;
CREATE TRIGGER IF NOT EXISTS ledger_immutable_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT,'immutable_ledger'); END;
COMMIT;
