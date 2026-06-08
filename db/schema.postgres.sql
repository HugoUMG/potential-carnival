CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  username TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'student')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS worksheets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  script_content TEXT NOT NULL,
  json_content JSONB NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published BOOLEAN NOT NULL DEFAULT FALSE,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  max_attempts INTEGER,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS worksheet_responses (
  id TEXT PRIMARY KEY,
  worksheet_id TEXT NOT NULL,
  student_id TEXT,
  student_name TEXT NOT NULL,
  answers_json JSONB NOT NULL,
  details_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  score DOUBLE PRECISION,
  correct_count INTEGER NOT NULL DEFAULT 0,
  pending_count INTEGER NOT NULL DEFAULT 0,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (worksheet_id) REFERENCES worksheets(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_worksheets_created_by ON worksheets(created_by);
CREATE INDEX IF NOT EXISTS idx_worksheets_published ON worksheets(published);
CREATE INDEX IF NOT EXISTS idx_worksheets_archived ON worksheets(archived);
CREATE INDEX IF NOT EXISTS idx_responses_worksheet_id ON worksheet_responses(worksheet_id);
CREATE INDEX IF NOT EXISTS idx_responses_student_id ON worksheet_responses(student_id);

CREATE TABLE IF NOT EXISTS classrooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS classroom_students (
  classroom_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (classroom_id, student_id),
  FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS classroom_worksheets (
  classroom_id TEXT NOT NULL,
  worksheet_id TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (classroom_id, worksheet_id),
  FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
  FOREIGN KEY (worksheet_id) REFERENCES worksheets(id) ON DELETE CASCADE
);

ALTER TABLE worksheets ADD COLUMN IF NOT EXISTS theme JSONB;

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  logged_in_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  logged_out_at TIMESTAMPTZ,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_logged_in ON user_sessions(logged_in_at);
CREATE INDEX IF NOT EXISTS idx_classrooms_created_by ON classrooms(created_by);
CREATE INDEX IF NOT EXISTS idx_classroom_students_student_id ON classroom_students(student_id);
CREATE INDEX IF NOT EXISTS idx_classroom_worksheets_worksheet_id ON classroom_worksheets(worksheet_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_responses_unique_attempt
ON worksheet_responses (worksheet_id, student_id)
WHERE student_id IS NOT NULL;

-- ── Grupos colaborativos ──────────────────────────────────────────────────────

ALTER TABLE worksheet_responses ADD COLUMN IF NOT EXISTS group_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_responses_unique_group_attempt
ON worksheet_responses (worksheet_id, group_id)
WHERE group_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  classroom_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS group_students (
  group_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  PRIMARY KEY (group_id, student_id),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS group_worksheets (
  group_id TEXT NOT NULL,
  worksheet_id TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, worksheet_id),
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (worksheet_id) REFERENCES worksheets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activity_locks (
  id TEXT PRIMARY KEY,
  worksheet_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  activity_index INTEGER NOT NULL,
  locked_by TEXT NOT NULL,
  locked_by_name TEXT NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (worksheet_id) REFERENCES worksheets(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
  FOREIGN KEY (locked_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_locks_unique
ON activity_locks (worksheet_id, group_id, activity_index);

CREATE INDEX IF NOT EXISTS idx_groups_classroom_id ON groups(classroom_id);
CREATE INDEX IF NOT EXISTS idx_group_students_student_id ON group_students(student_id);
CREATE INDEX IF NOT EXISTS idx_group_worksheets_worksheet_id ON group_worksheets(worksheet_id);
CREATE INDEX IF NOT EXISTS idx_activity_locks_group_worksheet ON activity_locks(group_id, worksheet_id);
