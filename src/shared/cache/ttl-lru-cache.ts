interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

export class TtlLruCache {
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #entries = new Map<string, CacheEntry<unknown>>();
  readonly #inflight = new Map<string, Promise<unknown>>();

  constructor(ttlMs = 5 * 60_000, maxEntries = 256) {
    this.#ttlMs = ttlMs;
    this.#maxEntries = maxEntries;
  }

  async getOrLoad<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const cached = this.#entries.get(key);
    if (cached && cached.expiresAt > now) {
      this.#entries.delete(key);
      this.#entries.set(key, cached);
      return cached.value as T;
    }
    if (cached) this.#entries.delete(key);

    const existing = this.#inflight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = loader()
      .then((value) => {
        this.#entries.set(key, { value, expiresAt: Date.now() + this.#ttlMs });
        this.#evict();
        return value;
      })
      .finally(() => {
        this.#inflight.delete(key);
      });
    this.#inflight.set(key, promise);
    return promise;
  }

  clear(): void {
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }

  #evict(): void {
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
  }
}
