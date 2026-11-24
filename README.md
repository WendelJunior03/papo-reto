# Papo Reto

PWA para aprender inglês pelo **método natural**: em vez de palavras soltas, 5 frases inteiras por dia, do jeito que os nativos falam (gíria quando cabe), com tradução natural, dica de uso, áudio e uma cena real usando as frases.

Feito com **TypeScript** e **Bun**, sem framework. Identidade visual da JMD (Space Grotesk, IBM Plex Mono, noite `#0B0530`, amarelo `#FEF203`).

## Rodar

```bash
bun install
bun dev          # desenvolvimento em http://localhost:3000 (recarrega sozinho)
bun test         # testes de lógica e de conteúdo
bun run typecheck
bun run build    # gera dist/ (com service worker para funcionar offline)
bun preview      # serve o dist/ em http://localhost:4173
bun run audio    # grava os áudios que faltam (macOS; --force regrava tudo)
```

Para testar no celular: rode `bun preview` e abra `http://<IP-do-Mac>:4173` na mesma rede Wi-Fi.
A instalação como app e o modo offline exigem **HTTPS** fora do `localhost`, então para usar de verdade publique o `dist/` (Cloudflare Pages, Netlify, Vercel ou GitHub Pages — é um site estático).

## Como funciona

- **60 situações · 300 frases · 600 exemplos · 300 perguntas/respostas · ~1.400 áudios.**
- **Hoje** — um pacote por dia (o primeiro dia de uso abre o pacote 1). Cada frase tem o trecho nativo grifado, tradução, dica com 2 exemplos extras (com áudio), **"Virar pergunta"** (ou "Ver resposta", quando a frase já é pergunta) mostrando a frase transformada e o que mudou na gramática, áudio normal e devagar, e "Sei essa".
- **Na vida real** — mini-diálogo com as frases do pacote; a tradução fica escondida até pedir.
- **Diálogo** — a cena do pacote, turno a turno: a outra pessoa fala (com áudio), você responde **em voz alta**. O reconhecimento de voz do navegador transcreve, o app compara com a fala certa (tolerante a contrações e pontuação) e marca o que faltou. Sem reconhecimento de voz, uma caixa de texto aceita o ditado do teclado. A melhor nota de cada cena fica salva.
- **IA** — papo livre (ou no papel da situação) com correção embaixo de cada fala; sessões de 7 min com 1 h de espera e notificação quando libera. Ele responde, traduz se você pedir e mostra o jeito natural de dizer o que você tentou.
- **Música** — treino de ouvido: busca (ou cola o link de) um vídeo do YouTube, a letra sincronizada vem do LRCLIB e algumas palavras somem. No fim da linha a música pausa e você escolhe entre 4 opções parecidas; dá pra ouvir a palavra, repetir o trecho e ajustar a sincronia. Três níveis.
- **Treinar** — flashcards de virar. *Falar*: vê o português e fala em inglês. *Ouvir*: só o áudio.
- **Repetição espaçada** (Leitner) — cada acerto empurra a próxima revisão (1, 3, 7, 16, 35 dias); erro volta pro começo. Revisões vencidas entram no treino junto com o pacote do dia.
- **Situações** — todos os pacotes com o progresso de cada um.
- **Sua evolução** (toque nos números do topo) — nível pelas frases dominadas, resumo da semana vs. a anterior, mapa de constância de 16 semanas, força da memória (caixas da repetição espaçada), gráficos de frases dominadas e da nota da fala nos diálogos, conquistas e a coleção das últimas expressões. Um histórico diário é salvo e sincronizado com a conta.
- Progresso salvo no aparelho (`localStorage`). Áudio gravado (public/audio, gerado com as vozes do macOS), guardado offline conforme cada pacote é aberto; a voz do celular fica de reserva.

## Apoio por PIX

A janela do PIX abre sozinha **na primeira abertura de cada dia**, pra quem ainda não apoiou ("Agora não" fecha; "Já apoiei" para de mostrar — PIX estático não tem confirmação de pagamento, então é na base da confiança). Também há o cartão "Apoie o projeto" na aba Situações e lembretes em conquistas (se a janela ainda não apareceu no dia). A janela gera o **PIX copia e cola** (BR Code do Banco Central, com CRC16) e o **QR Code**, com valor livre ou sugerido (R$ 5, 10, 20).

Configuração: `PIX_KEY`, `PIX_NAME` e `PIX_CITY` no `.env` (local) ou `bunx wrangler secret put PIX_KEY` etc. (produção). Sem `PIX_KEY`, o apoio fica escondido. Use **chave aleatória** pra não expor CPF/telefone.

## Música (treino de ouvido)

- Player oficial do YouTube (IFrame API) e letra sincronizada do [LRCLIB](https://lrclib.net) (aberto, sem chave). As letras são buscadas na hora e não ficam guardadas no app.
- Busca por nome: precisa de `YOUTUBE_API_KEY` (YouTube Data API v3, grátis, ~100 buscas/dia). Sem a chave, a pessoa cola o link do vídeo.
- Lacunas e opções: `src/lib/lyrics.ts` (sem palavras curtas/comuns, opções parecidas por distância de edição, mesma música = mesmas lacunas).

## Contas e banco de dados

O app exige login (usuário e senha). Banco **SQLite**: no Mac é o arquivo `data/papo.db` (criado sozinho), em produção é o **Cloudflare D1** — mesmo SQL (`migrations/0001_init.sql`).

- Senhas com hash PBKDF2-SHA256 + sal; sessão em cookie HttpOnly de 30 dias (no banco só o hash do token).
- 5 senhas erradas seguidas bloqueiam a conta por 10 minutos.
- **Cadastro só com código de convite** (`SIGNUP_CODE` no `.env`). Sem código configurado, o cadastro fica fechado.
- O progresso de cada usuário fica na conta e é combinado entre aparelhos (o mais avançado de cada frase vence). Offline, quem já entrou no aparelho continua usando; sincroniza quando a internet volta.

Configuração local: o Bun lê o `.env` sozinho (veja `.env.example`).

Publicar no Cloudflare:
```bash
bunx wrangler d1 create papo-reto              # copie o database_id pro wrangler.toml
bunx wrangler d1 migrations apply papo-reto --remote
bunx wrangler secret put SIGNUP_CODE
bunx wrangler secret put ANTHROPIC_API_KEY   # opcional: chave do app pra quem não tem a própria
bun run build && bunx wrangler deploy
```

## Conversa com IA

**Padrão: Gemini (chave do app), em sessões.** Cada sessão dura **7 minutos** (até 40 mensagens) e começa na primeira mensagem; depois há **1 hora de espera**. Quando libera, o app manda uma **notificação** (Web Push) — a pessoa ativa em "Me avise quando liberar".

- **Papo livre** (padrão): conversa sobre o que a pessoa quiser com o "Sam", um americano simpático. Ou **Situação**: a IA faz o papel da cena do pacote.
- Embaixo de cada fala da pessoa: a **correção** com o jeito natural de dizer e a explicação, ou o selo **Natural** quando estava certo.
- Modelos do Gemini: tenta `gemini-3.8-flash` e cai pro `gemini-3.5-flash-lite` se estiver sobrecarregado.
- **Chave própria** (Gemini `AIza…`, OpenAI `sk-…` ou Anthropic `sk-ant-…`) colada na aba IA: sem limite de sessão, cobrada na conta da pessoa. Fica só no aparelho e vai por HTTPS a cada mensagem; o servidor não guarda.
- Notificações: o cron do Worker (a cada minuto) envia os avisos agendados. No iPhone, só com o app instalado na Tela de Início (iOS 16.4+).

Configuração (`.env` local ou `bunx wrangler secret put …`): `GEMINI_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (gerar com `generateVapid()` de `server/push.ts`).

## Estrutura

```
src/
  index.html          entrada (Bun empacota TS e CSS a partir daqui)
  main.ts             eventos, render, instalação do PWA
  state.ts            estado do app e ações
  styles.css
  icons.ts
  sw.ts               service worker (offline)
  data/
    types.ts          formato de um pacote
    packs-core.ts     12 pacotes base
    packs-extra.ts    18 pacotes (supermercado, academia, aeroporto…)
    packs-more-*.ts   30 pacotes (dia a dia, trabalho/estudo, vida social)
  lib/                datas, repetição espaçada, agenda, armazenamento, voz
  views/              telas Hoje, Diálogo, IA, Treinar e Situações
server/               API (login, progresso, IA) e banco — roda no Bun e no Cloudflare Worker
migrations/           SQL do banco
worker/               entrada do Cloudflare Worker
scripts/              dev, build e preview com Bun
tests/                bun test
public/               manifest, ícones e áudios
```

## Adicionar frases

Crie um pacote em `src/data/packs-extra.ts` seguindo o tipo `Pack` de `src/data/types.ts`:

- `id` estável em kebab-case (é a chave do progresso salvo — não renomeie depois de publicado)
- exatamente 5 frases, cada uma com **um** trecho entre `[colchetes]` e 2 `examples` usando o mesmo trecho
- uma cena de 3–4 falas usando os trechos

Depois rode `bun run audio` pra gravar os áudios. `bun test` confere ids únicos, um trecho grifado por frase, frases sem repetição e cenas usando o pacote.
