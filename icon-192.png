import { redis, HISTORY_KEY } from "./_lib/db.js";
import { checkPassword, setCors } from "./_lib/auth.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!checkPassword(req, res)) return;

  if (req.method === "GET") {
    const limit = parseInt(req.query.limit, 10) || 50;
    const raw = await redis.lrange(HISTORY_KEY, 0, limit - 1);
    const items = raw.map((entry) =>
      typeof entry === "string" ? JSON.parse(entry) : entry
    );
    return res.status(200).json({ items });
  }

  if (req.method === "DELETE") {
    await redis.del(HISTORY_KEY);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "método não permitido" });
}
