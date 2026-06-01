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
