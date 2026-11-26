-- Transcrições de áudio no servidor (Diálogo no iPhone): quantas por pessoa por dia, pro limite.
CREATE TABLE IF NOT EXISTS transcribe_usage (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     TEXT    NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
