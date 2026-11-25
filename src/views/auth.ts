import { esc } from "../lib/html";

export type AuthMode = "login" | "signup";

export interface AuthView {
  mode: AuthMode;
  error: string | null;
  busy: boolean;
  username: string;
  /** Código de convite (vem preenchido pelo link ?convite=). */
  code: string;
}

export function renderAuth(v: AuthView): string {
  const signup = v.mode === "signup";
  return `<div class="page auth-page">
  <section class="on-dark hero auth-hero"><canvas id="dots" aria-hidden="true"></canvas><div class="wrap">
    <div class="hero-meta mono"><span><i class="live"></i>Método natural</span><span>5 frases por dia</span></div>
    <h1>Inglês do jeito <span class="mark">nativo.</span></h1>
    <p class="lead">Frases inteiras do dia a dia, diálogos falados e conversa com IA.</p>
  </div></section>
  <section class="band"><div class="wrap">
    <form class="auth-card" data-form="${v.mode}" novalidate>
      <span class="eyebrow">${signup ? "Criar conta" : "Entrar"}</span>
      <h2>${signup ? "Bem-vindo ao <span class=\"mark\">Papo Reto.</span>" : "Bom te ver de <span class=\"mark\">volta.</span>"}</h2>
      <label class="field"><span>Usuário</span>
        <input id="auth-user" name="username" autocomplete="username" autocapitalize="off" spellcheck="false"
          required minlength="3" maxlength="40" value="${esc(v.username)}">
        ${signup ? `<small>Seu nome, apelido ou e-mail.</small>` : ""}</label>
      <label class="field"><span>Senha</span>
        <input id="auth-pass" name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}"
          required minlength="${signup ? 8 : 1}" maxlength="128">
        ${signup ? `<small>Pelo menos 8 caracteres.</small>` : ""}</label>
      ${
        signup
          ? `<label class="field"><span>Código de convite</span>
              <input id="auth-code" name="code" autocomplete="off" autocapitalize="off" spellcheck="false" required value="${esc(v.code)}">
              <small>${v.code ? "Convite de um amigo — já está preenchido." : "Use o convite de um amigo ou o código de quem administra o app."}</small></label>`
          : ""
      }
      ${v.error ? `<p class="dl-err" role="alert">${esc(v.error)}</p>` : ""}
      <button class="btn btn-am btn-lg" type="submit" ${v.busy ? "disabled" : ""}>${v.busy ? "Aguarde…" : signup ? "Criar conta" : "Entrar"}</button>
      <p class="auth-switch">${
        signup
          ? `Já tem conta? <button type="button" class="link-btn" data-auth="login">Entrar</button>`
          : `Primeira vez? <button type="button" class="link-btn" data-auth="signup">Criar conta com convite</button>`
      }</p>
    </form>
  </div></section>
  </div>`;
}
