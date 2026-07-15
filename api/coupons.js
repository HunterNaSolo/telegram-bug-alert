import * as cheerio from "cheerio";
import {
  redis,
  CONFIG_KEY,
  HISTORY_KEY,
  HISTORY_MAX,
  COUPONS_KEY,
  lastSeenKey,
  notifiedSetKey,
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

async function checkChannel(channel, keywords) {
  const url = `https://t.me/s/${channel}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; BugAlertBot/1.0)" },
  });
  if (!resp.ok) return { channel, error: `HTTP ${resp.status}` };

  const html = await resp.text();
  const $ = cheerio.load(html);

  const lastSeenId = await getLastSeenId(channel);
  let maxIdSeen = lastSeenId;
  let achados = 0;

  const messages = [];
  const seenIdsThisRun = new Set();
  $(".tgme_widget_message").each((_, el) => {
    const dataPost = $(el).attr("data-post");
    if (!dataPost) return;
    const msgId = parseInt(dataPost.split("/")[1], 10);
    if (!msgId) return;
    // evita duplicata quando o Telegram renderiza o mesmo post em mais de um bloco
    // (ex: álbuns com várias fotos no mesmo post)
    if (seenIdsThisRun.has(msgId)) return;
    seenIdsThisRun.add(msgId);
    const text = $(el).find(".tgme_widget_message_text").text() || "";
    messages.push({ msgId, text });
  });

  for (const { msgId, text } of messages) {
    if (msgId <= lastSeenId) continue;
    if (msgId > maxIdSeen) maxIdSeen = msgId;

    const textNormalized = normalize(text);
    const matched = keywords.find((k) => textNormalized.includes(k));
    if (matched) {
      // dedupe permanente: uma vez que o msgId entra nesse set, ele nunca mais
      // dispara notificação de novo — mesmo que o lastSeenId seja perdido/resetado
      const setKey = notifiedSetKey(channel);
      const alreadyNotified = await redis.sismember(setKey, msgId);
      if (!alreadyNotified) {
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
        await redis.sadd(setKey, msgId);
      }
    }

    // detecção de cupom é independente das palavras-chave configuradas
    if (textNormalized.includes("cupom")) {
      const link = `https://t.me/${channel}/${msgId}`;
      await saveCoupon({
        channel,
        text: text.slice(0, 500),
        link,
      });
    }
  }

  if (maxIdSeen > lastSeenId) {
    await setLastSeenId(channel, maxIdSeen);
  }

  return { channel, novasMensagens: maxIdSeen - lastSeenId, achados };
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
  for (const channel of channels) {
    try {
      results.push(await checkChannel(channel, keywords));
    } catch (err) {
      results.push({ channel, error: err.message });
    }
  }

  return res.status(200).json({ checkedAt: new Date().toISOString(), results });
}
