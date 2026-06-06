CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  username TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'teacher', 'student')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS worksheets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  script_content TEXT NOT NULL,
  json_content TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS worksheet_responses (
  id TEXT PRIMARY KEY,
  worksheet_id TEXT NOT NULL,
  student_id TEXT,
  student_name TEXT NOT NULL,
  answers_json TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '[]',
  score REAL,
  correct_count INTEGER NOT NULL DEFAULT 0,
  pending_count INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS classroom_students (
  classroom_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (classroom_id, student_id),
  FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS classroom_worksheets (
  classroom_id TEXT NOT NULL,
  worksheet_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (classroom_id, worksheet_id),
  FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
  FOREIGN KEY (worksheet_id) REFERENCES worksheets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_classrooms_created_by ON classrooms(created_by);
CREATE INDEX IF NOT EXISTS idx_classroom_students_student_id ON classroom_students(student_id);
CREATE INDEX IF NOT EXISTS idx_classroom_worksheets_worksheet_id ON classroom_worksheets(worksheet_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_responses_unique_attempt
ON worksheet_responses (worksheet_id, student_id)
WHERE student_id IS NOT NULL;
