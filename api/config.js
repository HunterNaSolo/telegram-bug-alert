import { redis, CONFIG_KEY } from "./_lib/db.js";
import { checkPassword, setCors } from "./_lib/auth.js";

function cleanList(value, name) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${name} deve ser uma lista de textos`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function cleanKeyword(value) {
  // Preserva o formato antigo, inclusive exclusões como "café -xícara".
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      typeof value.main !== "string" || !value.main.trim()) {
    throw new Error("Cada produto deve ter um nome principal válido");
  }
  return {
    main: value.main.trim(),
    synonyms: cleanList(value.synonyms ?? [], "Sinônimos"),
    require: cleanList(value.require ?? [], "Termos obrigatórios"),
    excludes: cleanList(value.excludes ?? [], "Exclusões"),
  };
}

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
    let config;
    try {
      config = {
        channels: cleanList(channels, "Canais"),
        keywords: keywords.map(cleanKeyword).filter(Boolean),
      };
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    try {
      await redis.set(CONFIG_KEY, config);
    } catch (error) {
      console.error("Falha ao salvar configuração:", error);
      return res.status(500).json({ error: "Não foi possível salvar a configuração. Tente novamente." });
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "método não permitido" });
}
