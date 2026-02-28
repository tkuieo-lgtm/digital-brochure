export async function onRequestPost(context) {
  return new Response(
    JSON.stringify({ ok: true, message: "API route alive" }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}
