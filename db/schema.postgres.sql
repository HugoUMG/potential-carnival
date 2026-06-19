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
ALTER TABLE classroom_worksheets ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ;

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
-- Antes había un UNIQUE INDEX (worksheet_id, student_id) que impedía más de una
-- respuesta por estudiante → rompía max_attempts > 1 e "ilimitada". Se elimina y se
-- reemplaza por un índice NO único (los intentos se cuentan por filas; el doble envío
-- accidental se evita con el bloqueo de 5s y el conteo de intentos en la app).
DROP INDEX IF EXISTS idx_responses_unique_attempt;
CREATE INDEX IF NOT EXISTS idx_responses_worksheet_student
ON worksheet_responses (worksheet_id, student_id);

-- Vocabulario
CREATE TABLE IF NOT EXISTS vocabulary_lists (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS vocabulary_assignments (
  list_id TEXT NOT NULL,
  classroom_id TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (list_id, classroom_id),
  FOREIGN KEY (list_id) REFERENCES vocabulary_lists(id) ON DELETE CASCADE,
  FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vocabulary_lists_created_by ON vocabulary_lists(created_by);
CREATE INDEX IF NOT EXISTS idx_vocabulary_assignments_classroom_id ON vocabulary_assignments(classroom_id);

-- Rol reader: acceso solo a vocabulario, contraseña no modificable
-- Ampliar el CHECK constraint del rol para incluir 'reader'
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'teacher', 'student', 'reader'));

-- Asignación directa lector → lista de vocabulario (sin pasar por aulas)
CREATE TABLE IF NOT EXISTS vocabulary_reader_assignments (
  reader_id TEXT NOT NULL,
  list_id   TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (reader_id, list_id),
  FOREIGN KEY (reader_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (list_id)   REFERENCES vocabulary_lists(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vocab_reader_list_id ON vocabulary_reader_assignments(list_id);

-- Acceso de invitado: token persistente en localStorage del navegador
ALTER TABLE worksheet_responses ADD COLUMN IF NOT EXISTS guest_token TEXT;
ALTER TABLE classrooms ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_responses_guest_attempt
ON worksheet_responses (worksheet_id, guest_token)
WHERE guest_token IS NOT NULL;

-- Registro de accesos de invitados (cada vez que entran al portal)
CREATE TABLE IF NOT EXISTS guest_access_logs (
  id            TEXT PRIMARY KEY,
  guest_token   TEXT NOT NULL,
  name          TEXT NOT NULL,
  classroom_id  TEXT NOT NULL,
  classroom_name TEXT NOT NULL,
  accessed_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_guest_access_logs_token ON guest_access_logs(guest_token);
CREATE INDEX IF NOT EXISTS idx_guest_access_logs_at ON guest_access_logs(accessed_at DESC);

-- Registro de sesiones de lectores (cada login al portal de vocabulario)
CREATE TABLE IF NOT EXISTS reader_access_logs (
  id            TEXT PRIMARY KEY,
  reader_id     TEXT NOT NULL,
  reader_name   TEXT NOT NULL,
  accessed_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reader_access_logs_reader ON reader_access_logs(reader_id);
CREATE INDEX IF NOT EXISTS idx_reader_access_logs_at ON reader_access_logs(accessed_at DESC);
