import {
  ageInDays,
  definedOr,
  or,
  parseLocation,
  retry,
  sampleKey
} from '../content/shared.js'

function mergeMetadata(a, b) {
  const merged = {
    time: Math.max(a.time, b.time),
    snr: definedOr(Math.max, a.snr, b.snr),
    rssi: definedOr(Math.max, a.rssi, b.rssi),
    observed: definedOr(or, a.observed, b.observed),
  };

  const setA = new Set(a.path);
  const setB = new Set(b.path);
  merged.path = Array.from(setA.union(setB));

  return merged;
}

export async function onRequest(context) {
  const request = context.request;
  const data = await request.json();
  const store = context.env.SAMPLES;

  const [lat, lon] = parseLocation(data.lat, data.lon);
  const key = sampleKey(lat, lon);
  const path = (data.path ?? []).map(p => p.toLowerCase());
  let metadata = {
    time: Date.now(),
    rssi: data.rssi ?? null,
    snr: data.snr ?? null,
    path: path,
    observed: data.observed ?? false,
  };

  // KV only allows one write to a key per second.
  // There's a strong possibility that's hit by #wardrive.
  await retry(async () => {
    const resp = await store.getWithMetadata(key);
    if (resp.value !== null
        && resp.metadata !== null
        && ageInDays(resp.metadata.time) < 1) {
      // Merge new information with existing if recent.
      metadata = mergeMetadata(metadata, resp.metadata);
    }

    console.log(`PUT ${key} -> ${JSON.stringify(metadata)}`);
    await store.put(key, "", {
      metadata: metadata
    });
  });

  return new Response('OK');
}
