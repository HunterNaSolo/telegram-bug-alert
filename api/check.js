import * as cheerio from "cheerio";
import {
  redis,
  CONFIG_KEY,
  HISTORY_KEY,
  HISTORY_MAX,
  COUPONS_KEY,
  COUPON_TTL_MS,
  lastSeenKey,
} from "./_lib/db.js";

function normalize(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .toLowerCase();
}

async function getConfig() {
  const config = (await redis.get(CONFIG_KEY)) || {};
  return {
    channels: config.channels || [],
    keywords: (config.keywords || ["BUG"]).map((k) => normalize(k)),
  };
}

async function getLastSeenId(channel) {
  const val = await redis.get(lastSeenKey(channel));
  return val ? Number(val) : 0;
}

async function setLastSeenId(channel, id) {
  await redis.set(lastSeenKey(channel), id);
}

function extractPrice(text) {
  // Procura padrões tipo "R$ 99,90", "R$99", "R$ 1.234,56"
  const match = text.match(/R\$\s?(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/i);
  if (!match) return null;
  const raw = match[1].replace(/\./g, "").replace(",", ".");
  const num = parseFloat(raw);
  return isNaN(num) ? null : num;
}

function extractCouponCode(text) {
  // Procura "cupom: XXXX", "cupom XXXX", "código: XXXX" etc.
  const match = text.match(/cupom:?\s*([A-Z0-9][A-Z0-9]{3,19})/i);
  return match ? match[1].toUpperCase() : null;
}

function extractStoreLink(text) {
  const match = text.match(/(https?:\/\/[^\s]+)/i);
  return match ? match[1].replace(/[.,;)\]]+$/, "") : null;
}

const STORE_PATTERNS = [
  { match: /meli\.la|mercadolivre|mercadolibre/i, name: "Mercado Livre" },
  { match: /shopee/i, name: "Shopee" },
  { match: /aliexpress|s\.click\.aliexpress/i, name: "AliExpress" },
  { match: /amazon|amzn\.to/i, name: "Amazon" },
  { match: /magazineluiza|magalu/i, name: "Magazine Luiza" },
  { match: /shein/i, name: "Shein" },
  { match: /americanas/i, name: "Americanas" },
  { match: /casasbahia/i, name: "Casas Bahia" },
];

function detectStore(link, text) {
  const target = `${link || ""} ${text || ""}`;
  for (const { match, name } of STORE_PATTERNS) {
    if (match.test(target)) return name;
  }
  return null;
}

async function saveHistory(entry) {
  const item = { ...entry, timestamp: new Date().toISOString() };
  await redis.lpush(HISTORY_KEY, JSON.stringify(item));
  await redis.ltrim(HISTORY_KEY, 0, HISTORY_MAX - 1);
}

async function saveCoupon(entry) {
  const now = Date.now();
  const item = { ...entry, timestamp: new Date(now).toISOString() };
  // score = timestamp, member = json (com um sufixo aleatório pra nunca colidir)
  await redis.zadd(COUPONS_KEY, {
    score: now,
    member: JSON.stringify({ ...item, _id: `${now}-${Math.random().toString(36).slice(2, 8)}` }),
  });
}

async function getExistingCouponLinks() {
  const cutoff = Date.now() - COUPON_TTL_MS;
  await redis.zremrangebyscore(COUPONS_KEY, 0, cutoff);
  const raw = await redis.zrange(COUPONS_KEY, cutoff, "+inf", { byScore: true });
  const links = new Set();
  raw.forEach((entry) => {
    const item = typeof entry === "string" ? JSON.parse(entry) : entry;
    if (item.link) links.add(item.link);
  });
  return links;
}

async function sendNotification(channel, keyword, text, link) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  await fetch(`https://ntfy.sh/${topic}`, {
    method: "POST",
    headers: {
      Title: `"${keyword.toUpperCase()}" encontrado em ${channel}`,
      Click: link,
      Priority: "urgent",
      Tags: "rotating_light",
    },
    body: text.slice(0, 300),
  });
}

async function checkChannel(channel, keywords, couponLinks) {
  const url = `https://t.me/s/${channel}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; BugAlertBot/1.0)" },
  });
  if (!resp.ok) return { channel, error: `HTTP ${resp.status}` };

  const html = await resp.text();
  const $ = cheerio.load(html);

  const lastSeenId = await getLastSeenId(channel);

  const messages = [];
  $(".tgme_widget_message").each((_, el) => {
    const dataPost = $(el).attr("data-post");
    if (!dataPost) return;
    const msgId = parseInt(dataPost.split("/")[1], 10);
    if (!msgId) return;
    const text = $(el).find(".tgme_widget_message_text").text() || "";
    messages.push({ msgId, text });
  });

  // separa só as mensagens realmente novas
  const newMessages = messages.filter((m) => m.msgId > lastSeenId);
  let achados = 0;
  const erros = [];

  if (newMessages.length > 0) {
    const maxIdSeen = Math.max(lastSeenId, ...newMessages.map((m) => m.msgId));

    // IMPORTANTE: salva a posição JÁ, antes de gastar tempo mandando notificação.
    // Assim, mesmo que a função seja interrompida por timeout logo abaixo,
    // essas mensagens não são reprocessadas (e re-notificadas) no próximo ciclo.
    await setLastSeenId(channel, maxIdSeen);

    for (const { msgId, text } of newMessages) {
      try {
        const textNormalized = normalize(text);
        const matched = keywords.find((k) => textNormalized.includes(k));
        if (matched) {
          achados++;
          const link = `https://t.me/${channel}/${msgId}`;
          const price = extractPrice(text);
          await sendNotification(channel, matched, text, link);
          await saveHistory({
            channel,
            keyword: matched,
            text: text.slice(0, 500),
            link,
            price,
          });
        }
      } catch (err) {
        // Uma falha nessa mensagem específica (ex: rede instável ao notificar)
        // não pode travar as mensagens seguintes — a posição já foi salva,
        // então só registramos o erro e seguimos pra próxima.
        erros.push({ msgId, error: err.message });
      }
    }
  }

  // Detecção de cupom: olha TODA a janela visível (não só mensagens novas),
  // porque grupos costumam EDITAR uma mensagem já existente pra inserir o
  // cupom depois. Evita duplicar checando se aquele link já foi salvo antes.
  let cuponsEncontrados = 0;
  for (const { msgId, text } of messages) {
    try {
      const link = `https://t.me/${channel}/${msgId}`;
      if (couponLinks.has(link)) continue;
      if (normalize(text).includes("cupom")) {
        const storeLink = extractStoreLink(text);
        await saveCoupon({
          channel,
          text: text.slice(0, 500),
          link,
          couponCode: extractCouponCode(text),
          storeLink,
          store: detectStore(storeLink, text),
        });
        couponLinks.add(link);
        cuponsEncontrados++;
      }
    } catch (err) {
      erros.push({ msgId, error: `cupom: ${err.message}` });
    }
  }

  return {
    channel,
    novasMensagens: newMessages.length,
    achados,
    cuponsEncontrados,
    janelaVisivel: messages.length,
    erros,
  };
}

export default async function handler(req, res) {
  if (req.query.token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const { channels, keywords } = await getConfig();

  if (channels.length === 0) {
    return res.status(200).json({ aviso: "Nenhum grupo configurado ainda", results: [] });
  }

  const results = [];
  const couponLinks = await getExistingCouponLinks();
  for (const channel of channels) {
    try {
      results.push(await checkChannel(channel, keywords, couponLinks));
    } catch (err) {
      results.push({ channel, error: err.message });
    }
  }

  return res.status(200).json({ checkedAt: new Date().toISOString(), results });
}
