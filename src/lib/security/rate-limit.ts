interface RateBucket {
  timestamps: number[];
}

const buckets = new Map<string, RateBucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const cutoff = now - windowMs;
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);

  if (bucket.timestamps.length >= maxRequests) {
    const oldest = bucket.timestamps[0] ?? now;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldest + windowMs - now) / 1000)
    );
    buckets.set(key, bucket);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
    };
  }

  bucket.timestamps.push(now);
  buckets.set(key, bucket);

  // Periodic cleanup to keep memory bounded in long-lived processes
  if (buckets.size > 5000) {
    for (const [k, b] of buckets.entries()) {
      if (b.timestamps.every((t) => t <= cutoff)) {
        buckets.delete(k);
      }
    }
  }

  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - bucket.timestamps.length),
    retryAfterSeconds: 0,
  };
}
