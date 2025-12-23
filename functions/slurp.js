import * as util from '../content/shared.js';

// Pull all the live data into the local emulator.
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const result = {
    imported_samples: 0,
    imported_repeaters: 0
  };

  if (url.hostname !== "localhost")
    return new Response("Only works in Wrangler.");

  const resp = await fetch("https://mesh-map.pages.dev/get-nodes");
  const data = await resp.json();

  const sampleInsertStmts = data.samples.map(s => {
    return context.env.DB
      .prepare(`
        INSERT OR IGNORE INTO samples
          (hash, time, rssi, snr, observed, repeaters)
        VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(
        s.id,
        util.fromTruncatedTime(s.time),
        s.rssi ?? null,
        s.snr ?? null,
        s.obs,
        JSON.stringify(s.path ?? [])
      );
  });
  context.env.DB.batch(sampleInsertStmts);
  result.imported_samples = sampleInsertStmts.length;

  const repeaterStore = context.env.REPEATERS;
  let work = data.repeaters.map(async r => {
    const key = `${r.id}|${r.lat.toFixed(4)}|${r.lon.toFixed(4)}`;
    const metadata = {
      time: util.fromTruncatedTime(r.time),
      id: r.id,
      name: r.name,
      lat: r.lat,
      lon: r.lon,
      elev: r.elev
    };
    await repeaterStore.put(key, "", { metadata: metadata });
    result.imported_repeaters++;
  });
  await Promise.all(work);

  return Response.json(result);
}
