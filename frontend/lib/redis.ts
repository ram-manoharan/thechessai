import { createClient, type RedisClientType } from "redis";

// Same hot-reload-safe singleton pattern as lib/prisma.ts.
const globalForRedis = globalThis as unknown as { redis?: RedisClientType };

function makeClient(): RedisClientType {
  const client: RedisClientType = createClient({ url: process.env.REDIS_URL });
  client.on("error", (err) => console.error("Redis client error:", err));
  return client;
}

export const redis = globalForRedis.redis ?? makeClient();

if (process.env.NODE_ENV !== "production") globalForRedis.redis = redis;

let connectPromise: Promise<unknown> | null = null;

/** Lazily connects once, reused across calls — node-redis errors if you call connect() twice. */
export async function getRedis(): Promise<RedisClientType> {
  if (!redis.isOpen) {
    connectPromise ??= redis.connect();
    await connectPromise;
  }
  return redis;
}
