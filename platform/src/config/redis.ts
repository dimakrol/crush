import Redis from 'ioredis';
import { env } from './env';

let redisClient: Redis;

export function getRedis(): Redis {
  if (!redisClient)
    throw new Error('Redis not connected — call connectRedis() first');
  return redisClient;
}

export async function connectRedis(): Promise<Redis> {
  redisClient = new Redis(env.REDIS_URL, { lazyConnect: true });
  await redisClient.connect();
  console.log('✅ Redis connected');
  return redisClient;
}

export async function closeRedis(): Promise<void> {
  await redisClient?.quit();
}
