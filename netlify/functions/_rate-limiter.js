/**
 * In-memory sliding-window rate limiter for public endpoints.
 * Resets on cold start — acceptable for MVP.
 *
 * Key format: "{ip}:{endpoint}"
 * Store: Map<string, { count: number, windowStart: number }>
 */

const store = new Map();

/**
 * Checks whether a request is allowed under the rate limit.
 *
 * @param {string} key - Unique key, typically "{ip}:{endpoint}"
 * @param {number} limit - Maximum requests allowed within the window
 * @param {number} [windowMs=60000] - Time window in milliseconds (default 1 minute)
 * @returns {{ allowed: boolean, retryAfter?: number }}
 */
export function checkRateLimit(key, limit, windowMs = 60000) {
  const now = Date.now();
  const entry = store.get(key);

  // If no entry or window has expired, start a new window
  if (!entry || entry.windowStart + windowMs < now) {
    store.set(key, { count: 1, windowStart: now });
    return { allowed: true };
  }

  // Within the current window — increment counter
  entry.count += 1;

  if (entry.count <= limit) {
    return { allowed: true };
  }

  // Limit exceeded — calculate retryAfter in seconds
  const windowEnd = entry.windowStart + windowMs;
  const retryAfter = Math.ceil((windowEnd - now) / 1000);

  return { allowed: false, retryAfter };
}
