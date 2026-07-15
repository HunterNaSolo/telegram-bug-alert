import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export const HISTORY_KEY = "bugalert:history";
export const CONFIG_KEY = "bugalert:config";
export const HISTORY_MAX = 200;

export function lastSeenKey(channel) {
  return `bugalert:lastseen:${channel}`;
}
