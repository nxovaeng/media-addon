import NodeCache from 'node-cache';

// TTL is in seconds. Default to 1 hour (3600s)
export const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

/**
 * Compatibility wrapper to make the transition easier
 */
export const db = {
  get: (key: string) => cache.get(key),
  set: (key: string, value: any, ttl?: number) => {
    return ttl !== undefined ? cache.set(key, value, ttl) : cache.set(key, value);
  },
  // Dummy functions to prevent crashes if called
  prepare: () => ({
    get: () => null,
    run: () => ({})
  }),
  exec: () => {}
};

export function purgeExpired() {
  // node-cache handles this automatically via checkperiod
}
