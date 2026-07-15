import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export const HISTORY_KEY = "bugalert:history";
export const CONFIG_KEY = "bugalert:config";
export const COUPONS_KEY = "bugalert:coupons";
export const HISTORY_MAX = 200;
export const COUPON_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

export function lastSeenKey(channel) {
  return `bugalert:lastseen:${channel}`;
}

// SET permanente (sem expiração) com todos os msgIds já notificados desse canal.
// Garante que a mesma mensagem nunca dispara notificação duas vezes.
export function notifiedSetKey(channel) {
  return `bugalert:notified:${channel}`;
}
