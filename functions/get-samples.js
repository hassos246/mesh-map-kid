export async function onRequest(context) {
  const url = new URL(context.request.url);
  const prefix = url.searchParams.get('p') ?? ''

  const { results } = await context.env.DB
    .prepare("SELECT * FROM samples WHERE hash LIKE ?")
    .bind(`${prefix}%`)
    .all()

  return Response.json(results);
}
