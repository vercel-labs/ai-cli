export async function pMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<PromiseSettledResult<R>[]> {
  concurrency = Math.max(1, concurrency);
  const results = Array.from<PromiseSettledResult<R>>({ length: items.length });
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      try {
        results[idx] = {
          status: "fulfilled",
          value: await fn(items[idx], idx),
        };
      } catch (reason) {
        results[idx] = { status: "rejected", reason };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}
