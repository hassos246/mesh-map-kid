// Gets all samples, coverage, and repeaters for the map.
// Lots of data to send back, so fields are minimized.
import * as util from '../content/shared.js';

export async function onRequest(context) {
  const coverageStore = context.env.COVERAGE;
  const sampleStore = context.env.SAMPLES;
  const repeaterStore = context.env.REPEATERS;
  const responseData = {
    coverage: [],
    samples: [],
    repeaters: []
  };

  // Coverage
  let cursor = null;
  do {
    const coverageList = await coverageStore.list({ cursor: cursor });
    cursor = coverageList.cursor ?? null;
    coverageList.keys.forEach(c => {
      const lastHeard = c.metadata.heard ? c.metadata.lastHeard : 0;
      const updated = c.metadata.updated ?? lastHeard;
      const lastObserved = c.metadata.lastObserved ?? lastHeard;

      const item = {
        id: c.name,
        obs: c.metadata.observed ?? c.metadata.heard ?? 0,
        rcv: c.metadata.heard ?? 0,
        lost: c.metadata.lost ?? 0,
        ut: util.truncateTime(updated),
        lht: util.truncateTime(lastHeard),
        lot: util.truncateTime(lastObserved),
      };

      // Don't send empty vales.
      const repeaters = c.metadata.hitRepeaters ?? [];
      if (repeaters.length > 0) {
        item.rptr = repeaters
      };
      if (c.metadata.snr) item.snr = c.metadata.snr;
      if (c.metadata.rssi) item.rssi = c.metadata.rssi;

      responseData.coverage.push(item);
    });
  } while (cursor !== null)

  // Samples
  // TODO: merge samples into coverage server-side?
  do {
    const samplesList = await sampleStore.list({ cursor: cursor });
    cursor = samplesList.cursor ?? null;
    samplesList.keys.forEach(s => {
      const path = s.metadata.path ?? [];
      const item = {
        id: s.name,
        time: util.truncateTime(s.metadata.time ?? 0),
        obs: s.metadata.observed ?? path.length > 0
      };

      // Don't send empty values.
      if (path.length > 0) {
        item.path = path
      };
      if (s.metadata.snr) item.snr = s.metadata.snr;
      if (s.metadata.rssi) item.rssi = s.metadata.rssi;

      responseData.samples.push(item);
    });
  } while (cursor !== null)

  // Repeaters
  do {
    const repeatersList = await repeaterStore.list({ cursor: cursor });
    repeatersList.keys.forEach(r => {
      responseData.repeaters.push({
        time: util.truncateTime(r.metadata.time ?? 0),
        id: r.metadata.id,
        name: r.metadata.name,
        lat: r.metadata.lat,
        lon: r.metadata.lon,
        elev: Math.round(r.metadata.elev ?? 0),
      });
    });
  } while (cursor !== null)

  return new Response(JSON.stringify(responseData));
}
