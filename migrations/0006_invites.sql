-- Convites de amigos e selos. Tabela à parte (e não colunas novas em users) porque
-- ALTER TABLE ADD COLUMN não aceita IF NOT EXISTS e as migrações rodam de novo a cada `bun dev`.
-- Uma linha por usuário, criada quando ele precisa: ao abrir o cartão de convite (code),
-- ao entrar com o convite de alguém (invited_by) ou ao escolher um selo (badge).
CREATE TABLE IF NOT EXISTS invites (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code        TEXT    UNIQUE,                                     -- código pessoal (8 símbolos, sem ambíguos)
  invited_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,    -- quem convidou (null = código geral)
  badge       TEXT                                                -- selo em uso (null = nenhum)
);
CREATE INDEX IF NOT EXISTS invites_by ON invites(invited_by);
