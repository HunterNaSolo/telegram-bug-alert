import { redis, COUPONS_KEY, COUPON_TTL_MS } from "./_lib/db.js";
import { checkPassword, setCors } from "./_lib/auth.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!checkPassword(req, res)) return;

  const cutoff = Date.now() - COUPON_TTL_MS;

  // remove tudo que já passou de 24h
  await redis.zremrangebyscore(COUPONS_KEY, 0, cutoff);

  if (req.method === "GET") {
    // pega os que ainda estão dentro das últimas 24h, mais recente primeiro
    const raw = await redis.zrange(COUPONS_KEY, cutoff, "+inf", {
      byScore: true,
      rev: true,
    });
    const items = raw.map((entry) =>
      typeof entry === "string" ? JSON.parse(entry) : entry
    );
    return res.status(200).json({ items });
  }

  return res.status(405).json({ error: "método não permitido" });
}
