-- Cadastro aberto: tentativas e contas criadas por rede (IP em hash), pra limitar robô e cadastro em massa.
-- Linhas com mais de 24 h são apagadas a cada cadastro.
CREATE TABLE IF NOT EXISTS signup_log (
  ip  TEXT    NOT NULL,
  at  INTEGER NOT NULL,
  ok  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS signup_log_ip ON signup_log(ip, at);
CREATE INDEX IF NOT EXISTS signup_log_at ON signup_log(at);
