import { redis, CONFIG_KEY } from "./_lib/db.js";
import { checkPassword, setCors } from "./_lib/auth.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!checkPassword(req, res)) return;

  if (req.method === "GET") {
    const config = (await redis.get(CONFIG_KEY)) || {};
    return res.status(200).json({
      channels: config.channels || [],
      keywords: config.keywords || ["BUG"],
    });
  }

  if (req.method === "POST") {
    const { channels, keywords } = req.body || {};
    if (!Array.isArray(channels) || !Array.isArray(keywords)) {
      return res.status(400).json({ error: "channels e keywords devem ser listas" });
    }
    const config = {
      channels: channels.map((c) => c.trim()).filter(Boolean),
      keywords: keywords.map((k) => k.trim()).filter(Boolean),
    };
    await redis.set(CONFIG_KEY, config);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "método não permitido" });
}
