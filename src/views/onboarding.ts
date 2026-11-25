/** Boas-vindas da primeira entrada: 3 passos em tela cheia (método, abas e rotina). */
import { ui } from "../icons";

const TABS: [string, string][] = [
  ["Hoje", "as 5 frases do dia, com áudio"],
  ["Diálogo", "a conversa da situação, falando"],
  ["IA", "bate-papo livre com correção"],
  ["Música", "complete a letra ouvindo"],
  ["Treinar", "revisão pra não esquecer"],
];

const STEPS: { title: string; body: string }[] = [
  {
    title: `Frases inteiras, <span class="mark">do jeito nativo.</span>`,
    body: `<div class="onb-phrase"><p lang="en">What's up?</p><small>E aí, beleza?</small></div>
      <p>Nada de decorar palavra solta: você aprende a frase pronta que o nativo usa, com a tradução embaixo e o áudio pra ouvir.</p>`,
  },
  {
    title: `Cinco abas, <span class="mark">um caminho.</span>`,
    body: `<ul class="onb-tabs">${TABS.map(([name, what]) => `<li><b>${name}</b><span>${what}</span></li>`).join("")}</ul>`,
  },
  {
    title: `Todo dia, <span class="mark">5 frases novas</span> + revisão.`,
    body: `<p>Poucos minutos por dia. O que você já viu volta na hora certa, até ficar natural.</p>`,
  },
];

export const ONBOARDING_STEPS = STEPS.length;

/** `step` de 1 a 3; 0 = fechada. */
export function renderOnboarding(step: number): string {
  const st = STEPS[step - 1];
  if (!st) return "";
  const last = step === STEPS.length;
  return `<div class="onb on-dark" role="dialog" aria-modal="true" aria-labelledby="onb-title" aria-describedby="onb-body">
    <div class="onb-in">
      <span class="eyebrow">Bem-vindo ao Papo Reto</span>
      <h2 id="onb-title">${st.title}</h2>
      <div id="onb-body" class="onb-body">${st.body}</div>
      <div class="onb-dots" role="img" aria-label="Passo ${step} de ${STEPS.length}">${STEPS.map((_, i) => `<i${i === step - 1 ? ` class="on"` : ""}></i>`).join("")}</div>
      <button class="btn btn-am btn-lg" id="onb-next" data-act="onb-next">${last ? "Começar" : `Próximo ${ui.arrow}`}</button>
      ${last ? "" : `<button class="link-btn onb-skip" data-act="onb-skip">Pular</button>`}
    </div>
  </div>`;
}
