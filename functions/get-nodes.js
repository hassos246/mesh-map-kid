// Gets all samples, coverage, and repeaters for the map.
// Lots of data to send back, so fields are minimized.
import * as util from '../content/shared.js';

export async function onRequest(context) {
  const coverageStore = context.env.COVERAGE;
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
        hrd: c.metadata.heard ?? 0,
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
  const { results: samples } = await context.env.DB
    .prepare("SELECT * FROM samples").run();
  console.log(samples);
  samples.forEach(s => {
    const path = JSON.parse(s.repeaters);
    const item = {
      id: s.hash,
      time: util.truncateTime(s.time ?? 0),
      obs: s.observed
    };

    // Don't send empty values.
    if (path.length > 0) {
      item.path = path
    };
    if (s.snr != null) item.snr = s.snr;
    if (s.rssi != null) item.rssi = s.rssi;

    responseData.samples.push(item);
  });

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

  return Response.json(responseData);
}
