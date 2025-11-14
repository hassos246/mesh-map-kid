export async function onRequest(context) {
  const store = context.env.SAMPLES;

  const samplesList = await store.list();
  // Migration from old key format
  // await Promise.all(samplesList.keys.map(async s => {
  //   const parts = s.name.split('|');
  //   if (parts.length === 3) {
  //     console.log(`${s.name} is old schema`);
  //     const metadata = s.metadata;
  //     const key = `${metadata.lat}|${metadata.lon}`;
  //     await store.put(key, "", {
  //       metadata: metadata,
  //       expirationTtl: 15552000  // 180 days
  //     });
  //     await store.delete(s.name);
  //   }
  // }));

  // Fix up key consistency
  await Promise.all(samplesList.keys.map(async s => {
      const metadata = s.metadata;
      const key = `${metadata.lat.toFixed(4)}|${metadata.lon.toFixed(4)}`;
      if (key !== s.name) {
        await store.put(key, "", {
          metadata: metadata,
          expirationTtl: 15552000  // 180 days
        });
        await store.delete(s.name);
      }
    }));

  return new Response('OK');
}
