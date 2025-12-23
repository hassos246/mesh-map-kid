async function migrateArchive(context, result) {
  const now = Date.now();
  const archived = await context.env.ARCHIVE.list();
  const insertStmts = [];
  const keysToDelete = [];

  // Limit batch size to stay within request limits.
  for (const k of archived.keys) {
    if (insertStmts.length >= 500) {
      result.archive_has_more = true;
      break;
    }

    const metadata = k.metadata;
    metadata.hash = k.name;
    insertStmts.push(context.env.DB
      .prepare("INSERT INTO sample_archive (time, data) VALUES (?, ?)")
      .bind(now, JSON.stringify(metadata)));
    keysToDelete.push(k.name);
  }

  if (insertStmts.length > 0) {
    await context.env.DB.batch(insertStmts);
    for (const k of keysToDelete) {
      await context.env.ARCHIVE.delete(k);
    }
  }

  result.archive_insert_time = now;
  result.archive_migrated = keysToDelete.length;
}

async function migrateSamples(context, result) {
  const now = Date.now();
  const samples = await context.env.SAMPLES.list();
  const insertStmts = [];
  const keysToDelete = [];

  // Limit batch size to stay within request limits.
  for (const k of samples.keys) {
    if (insertStmts.length >= 500) {
      result.samples_has_more = true;
      break;
    }

    const metadata = k.metadata;
    insertStmts.push(context.env.DB
      .prepare(`
        INSERT OR IGNORE INTO samples
          (hash, time, rssi, snr, observed, repeaters)
        VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(
        k.name,
        metadata.time,
        metadata.rssi ?? null,
        metadata.snr ?? null,
        metadata.observed ?? 0,
        JSON.stringify(metadata.path ?? [])
      ));
    keysToDelete.push(k.name);
  }

  if (insertStmts.length > 0) {
    await context.env.DB.batch(insertStmts);
    for (const k of keysToDelete) {
      await context.env.SAMPLES.delete(k);
    }
  }

  result.samples_insert_time = now;
  result.samples_migrated = keysToDelete.length;
}

export async function onRequest(context) {
  const result = {};
  const url = new URL(context.request.url);
  const op = url.searchParams.get('op');

  switch (op) {
    case "archive":
      await migrateArchive(context, result);
      break;
    case "samples":
      await migrateSamples(context, result);
      break;
  }

  return Response.json(result);
}