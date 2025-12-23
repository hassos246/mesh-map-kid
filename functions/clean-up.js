import * as util from '../content/shared.js';

async function deleteOutOfRange(store, hash) {
  const pos = util.posFromHash(hash);
  if (!util.isValidLocation(pos)) {
    console.log(`Coverage ${hash} is out of range`);
    await store.delete(hash);
    return 1;
  }

  return 0;
}

async function cleanCoverage(context, result) {
  const store = context.env.COVERAGE;
  let cursor = null;

  result.coverage_out_of_range = 0;

  do {
    const coverage = await store.list({ cursor: cursor });
    cursor = coverage.cursor ?? null;

    for (const key of coverage.keys) {
      result.coverage_out_of_range += await deleteOutOfRange(store, key.name);
    }
  } while (cursor !== null);
}

async function cleanSamples(context, result) {
}

function overlaps(a, b) {
  const dist = util.haversineMiles(a, b);
  return dist <= 0.25;  // Consider anything under 1/4 mile overlapped.
}

function groupByOverlap(items) {
  const groups = [];

  for (const i of items) {
    let found = false;
    const loc = [i.metadata.lat, i.metadata.lon];

    // Look for an existing overlap group.
    // TODO: Technically should compute a group center for comparison.
    for (const g of groups) {
      if (overlaps(g.loc, loc)) {
        g.items.push(i);
        found = true;
        break;
      }
    }

    if (!found) {
      // Add a new group.
      groups.push({ id: i.metadata.id, loc: loc, items: [i] });
    }
  }

  return groups;
}

async function deduplicateGroup(group, store) {
  let deletedRepeaters = 0;

  if (group.items.length === 1) {
    //console.log(`Group ${group.id} ${group.loc} only has 1 item.`);
    return deletedRepeaters;
  }

  // In groups with duplicates, keep the newest.
  const itemsToDelete = [];
  group.items.reduce((max, current) => {
    if (max === null) {
      return current;
    }
    itemsToDelete.push(max.metadata.time > current.metadata.time ? current : max);
    return max.metadata.time > current.metadata.time ? max : current;
  }, null);

  // Delete all the older items.
  await Promise.all(itemsToDelete.map(async i => {
    console.log(`Deleting duplicate of [${group.id} ${group.loc}] ${i.name}`);
    await store.delete(i.name);
    deletedRepeaters++;
  }));

  return deletedRepeaters;
}

async function cleanRepeaters(context, result) {
  const store = context.env.REPEATERS;
  const repeatersList = await store.list();
  const indexed = new Map();

  result.deleted_stale_repeaters = 0;
  result.deleted_dupe_repeaters = 0;

  // Delete stale entries.
  await Promise.all(repeatersList.keys.map(async r => {
    const time = r.metadata.time ?? 0;
    if (util.ageInDays(time) > 10) {
      console.log(`Deleting stale ${r.name}`);
      await store.delete(r.name);
      result.deleted_stale_repeaters++;
    }
  }));

  // Index repeaters by Id.
  repeatersList.keys.forEach(r => {
    const metadata = r.metadata;
    const items = indexed.get(metadata.id) ?? [];
    items.push(r);
    indexed.set(metadata.id, items);
  });

  // Compute overlap groups and deduplicate.
  await Promise.all(indexed.entries().map(async ([key, val]) => {
    if (val.length >= 1) {
      const groups = groupByOverlap(val);
      await Promise.all(groups.map(async g => {
        result.deleted_dupe_repeaters += await deduplicateGroup(g, store);
      }));
    }
  }));
}

export async function onRequest(context) {
  const result = {};

  const url = new URL(context.request.url);
  const op = url.searchParams.get('op');

  switch (op) {
    case "coverage":
      await cleanCoverage(context, result);
      break;

    case "samples":
      await cleanSamples(context, result);
      break;

    case "repeaters":
      await cleanRepeaters(context, result);
      break;
  }

  return Response.json(result);
}
