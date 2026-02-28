import { createClient } from "@supabase/supabase-js";

// CORS בסיסי (כדי שהדפדפן יאפשר קריאות)
function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin");

  // Preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const SERVICE_ROLE = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing Supabase env vars" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      }
    );
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  // GET /api/brochures  -> מחזיר רשימת חוברות
  if (request.method === "GET") {
    const { data, error } = await supabase
      .from("brochures")
      .select("id,title,description,pdf_path")
      .order("title", { ascending: true });

    if (error) {
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    return new Response(JSON.stringify({ ok: true, data }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }

  // POST /api/brochures -> מוסיף רשומה לטבלה
  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const { title, description, pdf_path } = body;

    if (!title || !pdf_path) {
      return new Response(
        JSON.stringify({ ok: false, error: "title and pdf_path are required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        }
      );
    }

    const { data, error } = await supabase
      .from("brochures")
      .insert({ title, description: description || "", pdf_path })
      .select()
      .single();

    if (error) {
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    return new Response(JSON.stringify({ ok: true, data }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }

  return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}
