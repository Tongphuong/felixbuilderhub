CREATE TABLE IF NOT EXISTS student_profiles (
  student_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  parent_name TEXT,
  email TEXT,
  phone TEXT,
  cefr_level TEXT CHECK (
    cefr_level IS NULL
    OR cefr_level IN ('pre_a1', 'a1', 'a2', 'b1', 'b2', 'c1', 'c2')
  ),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  goals TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_student_profiles_active_status
  ON student_profiles(status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_student_profiles_updated_at
  ON student_profiles(updated_at);
