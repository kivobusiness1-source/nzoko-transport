// ============================================================
// OCÉAN DU NORD — Rate limiting en mémoire (anti brute force/spam)
// Adapté mono-instance (sandbox). En production multi-instances :
// remplacer par Redis (interface identique).
// ============================================================

import { ApiError, ERROR_CODES } from "@/lib/api-response";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

function sweep(): void {
  const now = Date.now();
  if (now - lastSweep < 60_000) return; // sweep au plus toutes les minutes
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  sweep();
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0, remaining: limit - 1 };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
      remaining: 0,
    };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0, remaining: limit - bucket.count };
}

/** Lève une ApiError 429 si la limite est dépassée. */
export function enforceRateLimit(key: string, limit: number, windowMs: number): void {
  const result = checkRateLimit(key, limit, windowMs);
  if (!result.allowed) {
    throw new ApiError(
      429,
      ERROR_CODES.RATE_LIMITED,
      `Trop de tentatives. Réessayez dans ${result.retryAfterSeconds} secondes.`
    );
  }
}
