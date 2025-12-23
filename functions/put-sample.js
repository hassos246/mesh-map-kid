import {
  parseLocation,
  sampleKey
} from '../content/shared.js'

export async function onRequest(context) {
  const request = context.request;
  const data = await request.json();

  // TODO: Pass geohash directly.
  const [lat, lon] = parseLocation(data.lat, data.lon);
  const key = sampleKey(lat, lon);

  const time = Date.now();
  const rssi = data.rssi ?? null;
  const snr = data.snr ?? null;
  const path = (data.path ?? []).map(p => p.toLowerCase());
  const observed = data.observed ?? false;

  await context.env.DB
    .prepare(`
      INSERT INTO samples (hash, time, rssi, snr, observed, repeaters)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(hash) DO UPDATE SET
        time = excluded.time,
        rssi = CASE
          WHEN samples.rssi IS NULL THEN excluded.rssi
          WHEN excluded.rssi IS NULL THEN samples.rssi
          ELSE MAX(samples.rssi, excluded.rssi)
        END,
        snr = CASE
          WHEN samples.snr IS NULL THEN excluded.snr
          WHEN excluded.snr IS NULL THEN samples.snr
          ELSE MAX(samples.snr, excluded.snr)
        END,
        observed = MAX(samples.observed, excluded.observed),
        repeaters = (
          SELECT json_group_array(value) FROM (
            SELECT value FROM json_each(samples.repeaters)
            UNION
            SELECT value FROM json_each(excluded.repeaters)
          )
        )
    `)
    .bind(key, time, rssi, snr, observed, JSON.stringify(path))
    .run();

  return new Response('OK');
}
