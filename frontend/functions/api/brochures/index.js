import { createClient } from "@supabase/supabase-js";

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

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const supabase = createClient(
    env.VITE_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY
  );

  // GET /api/brochures
  if (request.method === "GET") {
    const { data, error } = await supabase.from("brochures").select("*");

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

  // POST /api/brochures  (multipart/form-data)
  if (request.method === "POST") {
    try {
      const form = await request.formData();

      // These keys are common patterns; adjust later if your frontend uses different names
      const title = (form.get("title") || "").toString().trim();
      const description = (form.get("description") || "").toString().trim();

      // file might be under "file" or "pdf"
      const file = form.get("file") || form.get("pdf");

      if (!file || typeof file === "string") {
        return new Response(
          JSON.stringify({
            ok: false,
            error: 'Missing PDF file in form-data. Expected field "file" (or "pdf").',
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
          }
        );
      }

      // Build a storage path
      const safeName = (file.name || "brochure.pdf").replace(/[^\w.\-]+/g, "_");
      const path = `brochures/${Date.now()}_${safeName}`;

      // Upload to Supabase Storage (bucket: pdfs)
      const { error: uploadError } = await supabase.storage
        .from("pdfs")
        .upload(path, file, {
          contentType: file.type || "application/pdf",
          upsert: false,
        });

      if (uploadError) {
        return new Response(
          JSON.stringify({ ok: false, error: uploadError.message }),
          {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
          }
        );
      }

      // Save row in DB
      const { data: row, error: insertError } = await supabase
        .from("brochures")
        .insert({
          title: title || safeName,
          description,
          pdf_path: path,
        })
        .select()
        .single();

      if (insertError) {
        return new Response(
          JSON.stringify({ ok: false, error: insertError.message }),
          {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
          }
        );
      }

      return new Response(JSON.stringify({ ok: true, data: row }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    } catch (e) {
      return new Response(
        JSON.stringify({ ok: false, error: String(e?.message || e) }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
        }
      );
    }
  }

  return new Response(JSON.stringify({ ok: false, error: "Method Not Allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}
