# BUG Alert — app de monitoramento de promoções no Telegram

App que você instala no celular (funciona como um app de verdade, com ícone
e tela cheia) pra gerenciar grupos e palavras-chave, e recebe notificação
push na hora que alguma palavra (ex: "BUG") aparecer numa mensagem nova de
um grupo/canal **público** do Telegram. Tem histórico de tudo que já foi
encontrado.

Funciona só com canais/grupos que tenham link público (`t.me/nomedogrupo`).
Grupos privados (por convite) não são cobertos por esse método.

## Como funciona
- Uma tela (o "app") deixa você adicionar/remover grupos e palavras-chave,
  e ver o histórico — tudo pelo celular, sem mexer em código.
- Por trás, uma função roda periodicamente, lê a versão web pública de cada
  canal (`https://t.me/s/canal`), compara com a última mensagem já vista
  (guardada no Upstash) e, se achar alguma palavra-chave numa mensagem nova,
  registra no histórico e dispara um push via **ntfy**.

---

## Passo 1 — Criar o banco de dados (Upstash, grátis, sem cartão)

1. Acesse **https://upstash.com**
2. Clique em **"Sign Up"** e entre com sua conta do **Google** ou **GitHub**
   (não pede cartão de crédito)
3. No painel, clique em **"Create Database"**
4. Dê um nome, ex: `bugalert`
5. Tipo: **Regional**, escolha uma região perto de você (ex: `sa-east-1` São Paulo,
   se disponível, ou `us-east-1`)
6. Clique em **"Create"**
7. Na página do banco que abrir, procure a seção **"REST API"**
8. Copie os valores de **`UPSTASH_REDIS_REST_URL`** e
   **`UPSTASH_REDIS_REST_TOKEN`** — vai usar no Passo 3

Isso é tudo — bem mais rápido que a AWS.

## Passo 2 — Criar o tópico do ntfy.sh (grátis, sem conta)

1. Instale o app **ntfy** na Play Store (ou App Store).
2. Dentro do app, inscreva-se num tópico com nome único e difícil de
   adivinhar, tipo `bugalert-seunome-8f2k` (qualquer pessoa que souber o
   nome do tópico recebe os avisos também, então escolha algo não óbvio).

## Passo 3 — Deploy no Vercel (grátis)

1. Crie uma conta em https://vercel.com (pode usar login do GitHub).
2. Suba essa pasta pra um repositório no seu GitHub.
3. No Vercel, clique em "Add New Project" e importe esse repositório.
4. Antes do deploy, vá em **Settings → Environment Variables** e adicione
   todas as variáveis do `.env.example`:
   - `APP_PASSWORD` — a senha que você vai usar pra entrar no app
   - `CRON_SECRET` — um token aleatório qualquer (protege a checagem automática)
   - `NTFY_TOPIC` — o tópico que você criou no Passo 2
   - `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` — do Passo 1
5. Clique em Deploy.

## Passo 4 — Instalar o app no celular

1. Abra `https://seu-projeto.vercel.app` no navegador do celular.
2. Digite a senha (`APP_PASSWORD`) que você configurou.
3. No menu do navegador, toque em **"Adicionar à tela de início"**
   (Android/Chrome) ou **"Adicionar à Tela de Início"** (iPhone/Safari).
4. Pronto — vai aparecer um ícone de app normal, e abrindo por ele fica em
   tela cheia, sem barra de navegador.
5. Dentro do app, adicione os grupos (nome do canal, sem @) e as
   palavras-chave que quiser, e toque em "Salvar configurações".

## Passo 5 — Fazer a checagem rodar sozinha

O plano gratuito do Vercel limita a frequência dos cron jobs nativos, então
o jeito mais confiável e ainda gratuito é usar um "pinger" externo:

1. Crie uma conta grátis em https://cron-job.org
2. Crie um novo cron job apontando pra:
   `https://seu-projeto.vercel.app/api/check?token=SEU_CRON_SECRET`
   (troque `SEU_CRON_SECRET` pelo valor que você colocou na variável
   `CRON_SECRET`)
3. Defina o intervalo (ex: a cada 2 ou 5 minutos).
4. Salve. A partir daí, ele checa os grupos sozinho e te avisa no celular
   assim que aparecer alguma palavra-chave.

---

## Resumo do fluxo completo

```
cron-job.org (dispara a cada poucos minutos)
        │
        ▼
/api/check  →  lê grupos/palavras salvos no Upstash
        │           │
        │           ▼
        │      busca https://t.me/s/canal de cada grupo
        │           │
        │           ▼
        │      encontrou palavra-chave numa mensagem nova?
        │           │
        │      ┌────┴────┐
        │      ▼         ▼
        │   salva      manda push
        │  histórico   via ntfy.sh
        │      │         │
        └──────┴─────────┴──→ você vê no app (histórico) e no celular (notificação)
```

## Testando localmente (opcional)

```bash
npm install
vercel dev
```

Depois acesse `http://localhost:3000` no navegador.
