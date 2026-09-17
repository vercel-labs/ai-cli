export interface PMapOptions {
  stopOnError?: boolean;
}

export async function pMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
  options: PMapOptions = {}
): Promise<PromiseSettledResult<R>[]> {
  concurrency = Math.max(1, concurrency);
  const results = Array.from<PromiseSettledResult<R>>({ length: items.length });
  let nextIdx = 0;
  let stopped = false;

  async function worker() {
    while (!stopped && nextIdx < items.length) {
      const idx = nextIdx++;
      try {
        results[idx] = {
          status: "fulfilled",
          value: await fn(items[idx], idx),
        };
      } catch (reason) {
        results[idx] = { status: "rejected", reason };
        if (options.stopOnError) stopped = true;
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return stopped ? results.slice(0, nextIdx) : results;
}
