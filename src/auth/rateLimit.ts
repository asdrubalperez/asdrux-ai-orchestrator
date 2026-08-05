// FEATURE-041, Scope "Rate limiting": protección inicial sin CAPTCHA para registro, login,
// recuperación de contraseña, reenvío de verificación y validación de tokens sensibles. Mismo
// mecanismo en memoria que ya existía solo para login (webSession.ts) -- generalizado acá a
// buckets nombrados en vez de duplicarlo por ruta. En memoria = por instancia, no distribuido; es
// la misma limitación que ya tenía el mecanismo original, documentada, no nueva de esta Feature.
interface RateLimitEntry {
  attempts: number;
  windowStartedAt: number;
}

export interface RateLimitBucketConfig {
  windowMs: number;
  maxAttempts: number;
}

const buckets = new Map<string, Map<string, RateLimitEntry>>();

function bucketFor(name: string): Map<string, RateLimitEntry> {
  let bucket = buckets.get(name);
  if (!bucket) {
    bucket = new Map();
    buckets.set(name, bucket);
  }
  return bucket;
}

export function rateLimitExceeded(
  bucketName: string,
  key: string,
  config: RateLimitBucketConfig,
  now = Date.now()
): boolean {
  const entry = bucketFor(bucketName).get(key);
  if (!entry) return false;
  if (now - entry.windowStartedAt > config.windowMs) {
    bucketFor(bucketName).delete(key);
    return false;
  }
  return entry.attempts >= config.maxAttempts;
}

export function recordRateLimitAttempt(bucketName: string, key: string, config: RateLimitBucketConfig, now = Date.now()): void {
  const bucket = bucketFor(bucketName);
  const entry = bucket.get(key);
  if (!entry || now - entry.windowStartedAt > config.windowMs) {
    bucket.set(key, { attempts: 1, windowStartedAt: now });
    return;
  }
  entry.attempts += 1;
}

export function clearRateLimit(bucketName: string, key: string): void {
  bucketFor(bucketName).delete(key);
}

export function resetAllRateLimitsForTests(): void {
  buckets.clear();
}

// FEATURE-041: buckets concretos de la Feature. Los límites son una decisión de implementación
// razonable (Scope: "se definirán durante implementación... sin crear un framework nuevo") -- se
// pueden ajustar sin tocar el mecanismo.
export const RATE_LIMIT_BUCKETS = {
  register: { windowMs: 60 * 60 * 1000, maxAttempts: 5 },
  resendVerification: { windowMs: 15 * 60 * 1000, maxAttempts: 3 },
  forgotPassword: { windowMs: 15 * 60 * 1000, maxAttempts: 3 },
  tokenValidation: { windowMs: 15 * 60 * 1000, maxAttempts: 10 },
} as const satisfies Record<string, RateLimitBucketConfig>;
