import * as util from '../content/shared.js';

// Pull all the live KV data into the local emulator.
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

  const sampleStore = context.env.SAMPLES;
  const repeaterStore = context.env.REPEATERS;

  let work = data.samples.map(async s => {
    const key = s.id;
    const metadata = {
      time: util.fromTruncatedTime(s.time),
      path: s.path ?? [],
      observed: s.obs,
      snr: s.snr ?? null,
      rssi: s.rssi ?? null
    };
    await sampleStore.put(key, "", { metadata: metadata });
    result.imported_samples++;
  });
  await Promise.all(work);

  work = data.repeaters.map(async r => {
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

  return new Response(JSON.stringify(result));
}
