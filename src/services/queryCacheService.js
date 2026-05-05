// create a query cache service
const DEFAULT_TTL_MS = 30 * 1000; // 30 seconds
const MAX_ENTRIES = 1000;
const store = new Map();
const now = () => Date.now();
const evictExpired = () => {
  const t = now();
  for (const [key, entry] of store.entries()) {
    if (entry.expiresAt <= t) store.delete(key);
  }
};
const evictOldestIfNeeded = () => {
  while (store.size > MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    if (!oldestKey) return;
    store.delete(oldestKey);
  }
};
const getCached = (key) => {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now()) {
    store.delete(key);
    return null;
  }
  return entry.value;
};
const setCached = (key, value, ttlMs = DEFAULT_TTL_MS) => {
  evictExpired();
  store.set(key, {
    value,
    expiresAt: now() + ttlMs,
  });
  evictOldestIfNeeded();
};
const clearByPrefix = (prefix) => {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
};
module.exports = {
  getCached,
  setCached,
  clearByPrefix,
  DEFAULT_TTL_MS,
};