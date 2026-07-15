export function checkPassword(req, res) {
  const sent = req.headers["x-app-password"];
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    res.status(500).json({ error: "APP_PASSWORD não configurado no servidor" });
    return false;
  }
  if (sent !== expected) {
    res.status(401).json({ error: "senha incorreta" });
    return false;
  }
  return true;
}

export function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-password");
}
