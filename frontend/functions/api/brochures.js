import { createClient } from "@supabase/supabase-js";

export async function onRequestPost(context) {
  const supabase = createClient(
    context.env.VITE_SUPABASE_URL,
    context.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data, error } = await supabase
    .from("brochures")
    .select("*");

  if (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500 }
    );
  }

  return new Response(
    JSON.stringify({ ok: true, data }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}
