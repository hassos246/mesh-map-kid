// Consolidates old samples into coverage elements and archives them.
import * as util from '../content/shared.js';

// TODO: App-token for 'auth'?
// TODO: More of this could be handled in SQL.

// Samples are consolidated after they are this age in days.
const DEF_CONSOLIDATE_AGE = 1;

// Only the N-newest samples are kept so that
// recent samples can eventually flip a coverage tile.
const MAX_SAMPLES_PER_COVERAGE = 15;

function consolidateSamples(samples, cutoffTime) {
  // To avoid people spamming the coverage data and blowing
  // up the history, merge the batch of new samples into
  // one uber-entry per-consolidation. That way spamming
  // has to happen over N consolidations.
  const uberSample = {
    time: 0,
    observed: 0,
    heard: 0,
    lost: 0,
    snr: null,
    rssi: null,
    lastObserved: 0,
    lastHeard: 0,
    repeaters: [],
  };

  // Build the uber sample.
  samples.forEach(s => {
    // Was this sample handled in a previous batch?
    if (s.time <= cutoffTime)
      return;

    uberSample.time = Math.max(s.time, uberSample.time);
    uberSample.snr = util.definedOr(Math.max, s.snr, uberSample.snr);
    uberSample.rssi = util.definedOr(Math.max, s.rssi, uberSample.rssi);

    if (s.observed) {
      uberSample.observed++;
      uberSample.lastObserved = Math.max(s.time, uberSample.lastObserved);
    }

    if (s.observed || s.repeaters.length > 0) {
      uberSample.heard++;
      uberSample.lastHeard = Math.max(s.time, uberSample.lastHeard);
    } else {
      uberSample.lost++;
    }

    const repeaters = JSON.parse(s.repeaters);
    repeaters.forEach(p => {
      if (!uberSample.repeaters.includes(p))
        uberSample.repeaters.push(p);
    });
  });

  // If uberSample has invalid time, all samples must have
  // been handled previously, nothing left to do.
  if (uberSample.time === 0)
    return null;
  else
    return uberSample;
}

// Merge the new coverage data with the previous (if any).
async function mergeCoverage(key, samples, store) {
  // Get existing coverage entry (or defaults).
  const entry = await store.getWithMetadata(key, "json");
  const prevRepeaters = entry?.metadata?.hitRepeaters ?? [];
  const prevUpdated = entry?.metadata?.updated ?? 0;
  let value = entry?.value ?? [];

  const uberSample = consolidateSamples(samples, prevUpdated);
  if (uberSample === null)
    return;

  // Migrate existing values to newest format.
  value.forEach(v => {
    // An older version saved 'time' as a string. Yuck.
    v.time = Number(v.time);

    if (v.heard === undefined) {
      const wasHeard = v.path?.length > 0;
      v.heard = wasHeard ? 1 : 0;
      v.lost = wasHeard ? 0 : 1;
      v.lastHeard = wasHeard ? v.time : 0;
      v.repeaters = v.path;
      delete v.path;
    }

    if (v.observed === undefined) {
      // All previously "heard" entries were observed.
      v.observed = v.heard;
      v.snr = null;
      v.rssi = null;
      v.lastObserved = v.lastHeard;
    }
  });

  value.push(uberSample);

  // Are there too many entries?
  if (value.length > MAX_SAMPLES_PER_COVERAGE) {
    // Sort and keep the N-newest.
    value = value.toSorted((a, b) => a.time - b.time).slice(-MAX_SAMPLES_PER_COVERAGE);
  }

  // Compute new metadata stats, but keep the existing repeater list (for now).
  const metadata = {
    observed: 0,
    heard: 0,
    lost: 0,
    snr: null,
    rssi: null,
    lastObserved: 0,
    lastHeard: 0,
    updated: uberSample.time,
    hitRepeaters: []
  };
  const repeaterSet = new Set(prevRepeaters);
  value.forEach(v => {
    metadata.observed += v.observed;
    metadata.heard += v.heard;
    metadata.lost += v.lost;
    metadata.snr = util.definedOr(Math.max, metadata.snr, v.snr);
    metadata.rssi = util.definedOr(Math.max, metadata.rssi, v.rssi);
    metadata.lastObserved = Math.max(metadata.lastObserved, v.lastObserved);
    metadata.lastHeard = Math.max(metadata.lastHeard, v.lastHeard);
    v.repeaters.forEach(r => repeaterSet.add(r.toLowerCase()));
  });
  metadata.hitRepeaters = [...repeaterSet];

  await store.put(key, JSON.stringify(value), { metadata: metadata });
}

export async function onRequest(context) {
  const coverageStore = context.env.COVERAGE;

  const url = new URL(context.request.url);
  let maxAge = url.searchParams.get('maxAge') ?? DEF_CONSOLIDATE_AGE; // Days
  if (maxAge <= 0)
    maxAge = DEF_CONSOLIDATE_AGE;

  const result = {
    coverage_to_update: 0,
    samples_to_update: 0,
    merged_ok: 0,
    merged_fail: 0,
    merged_skip: 0,
  };
  const now = Date.now();
  const hashToSamples = new Map();

  // Get old samples.
  const { results: samples } = await context.env.DB
    .prepare("SELECT * FROM samples WHERE time < ?")
    .bind(now - (maxAge * util.dayInMillis))
    .all();
  console.log(`Old samples:${samples.length}`);
  result.samples_to_update = samples.length;

  // Build index of old samples - group by 6-digit hash.
  samples.forEach(s => {
    const key = s.hash.substring(0, 6);
    util.pushMap(hashToSamples, key, s);
  });
  console.log(`Coverage to update:${hashToSamples.size}`);
  result.coverage_to_update = hashToSamples.size

  const mergedKeys = [];
  let mergeCount = 0;

  // Merge old samples into coverage items.
  for (const [k, v] of hashToSamples.entries()) {
    // To prevent hitting KV limits, only handle first N.
    if (++mergeCount > 500)
      break;

    try {
      await mergeCoverage(k, v, coverageStore);
      result.merged_ok++;
      mergedKeys.push(k);
    } catch (e) {
      console.log(`Merge failed. ${e}`);
      result.merged_fail++;
    }
  }
  result.merged_skip = hashToSamples.size - (result.merged_ok + result.merged_fail);

  // Archive and delete the old samples.
  const cleanupStmts = [];
  mergedKeys.forEach(k => {
    const v = hashToSamples.get(k);
    for (const sample of v) {
      cleanupStmts.push(context.env.DB
        .prepare("INSERT INTO sample_archive (time, data) VALUES (?, ?)")
        .bind(now, JSON.stringify(sample)));
      cleanupStmts.push(context.env.DB
        .prepare("DELETE FROM samples WHERE hash == ?")
        .bind(sample.hash));
    }
  });
  if (cleanupStmts.length > 0)
    await context.env.DB.batch(cleanupStmts);

  return Response.json(result);
}
