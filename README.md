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

- **60 situações · 300 frases · 600 exemplos · ~1.100 áudios.**
- **Hoje** — um pacote por dia (o primeiro dia de uso abre o pacote 1). Cada frase tem o trecho nativo grifado, tradução, dica com 2 exemplos extras (com áudio), áudio normal e devagar, e "Sei essa".
- **Na vida real** — mini-diálogo com as frases do pacote; a tradução fica escondida até pedir.
- **Diálogo** — a cena do pacote, turno a turno: a outra pessoa fala (com áudio), você responde **em voz alta**. O reconhecimento de voz do navegador transcreve, o app compara com a fala certa (tolerante a contrações e pontuação) e marca o que faltou. Sem reconhecimento de voz, uma caixa de texto aceita o ditado do teclado. A melhor nota de cada cena fica salva.
- **IA** — conversa livre com um nativo no papel da situação, usando a chave de IA da própria pessoa (OpenAI ou Anthropic). Ele responde, traduz se você pedir e mostra o jeito natural de dizer o que você tentou.
- **Treinar** — flashcards de virar. *Falar*: vê o português e fala em inglês. *Ouvir*: só o áudio.
- **Repetição espaçada** (Leitner) — cada acerto empurra a próxima revisão (1, 3, 7, 16, 35 dias); erro volta pro começo. Revisões vencidas entram no treino junto com o pacote do dia.
- **Situações** — todos os pacotes com o progresso de cada um.
- **Sua evolução** (toque nos números do topo) — nível pelas frases dominadas, resumo da semana vs. a anterior, mapa de constância de 16 semanas, força da memória (caixas da repetição espaçada), gráficos de frases dominadas e da nota da fala nos diálogos, conquistas e a coleção das últimas expressões. Um histórico diário é salvo e sincronizado com a conta.
- Progresso salvo no aparelho (`localStorage`). Áudio gravado (public/audio, gerado com as vozes do macOS), guardado offline conforme cada pacote é aberto; a voz do celular fica de reserva.

## Apoio por PIX

A janela do PIX abre sozinha **na primeira abertura de cada dia**, pra quem ainda não apoiou ("Agora não" fecha; "Já apoiei" para de mostrar — PIX estático não tem confirmação de pagamento, então é na base da confiança). Também há o cartão "Apoie o projeto" na aba Situações e lembretes em conquistas (se a janela ainda não apareceu no dia). A janela gera o **PIX copia e cola** (BR Code do Banco Central, com CRC16) e o **QR Code**, com valor livre ou sugerido (R$ 5, 10, 20).

Configuração: `PIX_KEY`, `PIX_NAME` e `PIX_CITY` no `.env` (local) ou `bunx wrangler secret put PIX_KEY` etc. (produção). Sem `PIX_KEY`, o apoio fica escondido. Use **chave aleatória** pra não expor CPF/telefone.

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

Cada pessoa pode usar **a própria chave de API** — da **OpenAI** (`sk-...`, modelo padrão `gpt-5.4-mini`) ou da **Anthropic** (`sk-ant-...`, modelo padrão `claude-opus-5`) — colando na aba IA. O modelo pode ser trocado.

- A chave fica salva **só no aparelho** da pessoa (não vai pro banco) e segue por HTTPS a cada mensagem até `POST /api/chat`, que repassa pra empresa de IA. O servidor não guarda nem registra.
- Opcional: o servidor pode ter uma chave própria (`ANTHROPIC_API_KEY` ou `OPENAI_API_KEY`) pra quem não tiver chave — com limite de 60 mensagens por dia por usuário (`AI_DAILY_LIMIT`).
- Login da CLI da OpenAI/ChatGPT não funciona em sites — só chave de API.

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
