/**
 * supabase/functions/filter-sources/index.ts
 *
 * UPDATED VERSION — routes to Python ML backend instead of Lovable AI.
 * Drop this in as a replacement for the existing filter-sources edge function.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sources, projectContext } = await req.json();

    if (!sources || !Array.isArray(sources)) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid sources array" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const PYTHON_BACKEND = Deno.env.get("PYTHON_BACKEND_URL") || "http://localhost:8000";

    // ── Route to Python ML backend ──────────────────────────────────────────
    const mlResponse = await fetch(`${PYTHON_BACKEND}/api/ml/filter-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources, threshold: 0.3 }),
    });

    if (!mlResponse.ok) {
      throw new Error(`ML backend error: ${mlResponse.status}`);
    }

    const result = await mlResponse.json();

    console.log(
      `Filter-sources: ${result.total_input} in → ${result.total_relevant} relevant ` +
      `(${result.noise_removed} noise removed)`
    );

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("filter-sources error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ────────────────────────────────────────────────────────────────────────────────

/**
 * supabase/functions/predict-delays/index.ts  (UPDATED)
 */

// serve(async (req) => {
//   const { projectId, taskIds } = await req.json();
//   const PYTHON_BACKEND = Deno.env.get("PYTHON_BACKEND_URL") || "http://localhost:8000";
//
//   // Fetch tasks from Supabase, then pass to Python for ML scoring
//   const supabase = createClient(supabaseUrl, supabaseKey);
//   const { data: tasks } = await supabase
//     .from("tasks").select("*").eq("project_id", projectId)
//     .in("status", ["backlog","todo","in_progress","in_review"]);
//
//   const mlResp = await fetch(`${PYTHON_BACKEND}/api/ml/predict-delays`, {
//     method: "POST",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({ project_id: projectId, tasks: tasks || [] }),
//   });
//   const result = await mlResp.json();
//   return new Response(JSON.stringify(result), { headers: corsHeaders });
// });

/**
 * HOW TO SET PYTHON_BACKEND_URL IN SUPABASE:
 *
 * supabase secrets set PYTHON_BACKEND_URL=https://your-backend.railway.app
 *
 * OR for local dev (if Supabase running locally):
 * supabase secrets set PYTHON_BACKEND_URL=http://host.docker.internal:8000
 */
