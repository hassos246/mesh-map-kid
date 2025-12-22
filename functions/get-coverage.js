export async function onRequest(context) {
  const store = context.env.COVERAGE;
  const result = [];
  let cursor = null;

  do {
    const coverage = await store.list({ cursor: cursor });
    cursor = coverage.cursor ?? null;
    await Promise.all(coverage.keys.map(async c => {
      const values = (await store.get(c.name, "json")) ?? []

      // Old coverage items only have "lastHeard".
      const lastHeard = c.metadata.heard ? c.metadata.lastHeard : 0;
      const updated = c.metadata.updated ?? lastHeard;
      const lastObserved = c.metadata.lastObserved ?? lastHeard;

      result.push({
        hash: c.name,
        observed: c.metadata.observed ?? c.metadata.heard,
        heard: c.metadata.heard ?? 0,
        lost: c.metadata.lost ?? 0,
        snr: c.metadata.snr ?? null,
        rssi: c.metadata.rssi ?? null,
        updated: updated,
        lastObserved: lastObserved,
        lastHeard: lastHeard,
        hitRepeaters: c.metadata.hitRepeaters ?? [],
        values: values
      });
    }));
  } while (cursor !== null)

  return new Response(JSON.stringify(result));
}
