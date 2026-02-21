import { serve } from "https://deno.land/std/http/server.ts";

serve(async (req) => {
  try {
    const { brdId } = await req.json();

    if (!brdId) {
      return new Response(
        JSON.stringify({ error: "Missing brdId" }),
        { status: 400 }
      );
    }

    /**
     * TODO (later):
     * - Fetch connected data sources (Gmail, Slack, Fireflies, uploads)
     * - Run LLM extraction
     * - Store structured requirements into BRD sections
     */

    // 🔹 TEMP: mock success so UI flow works
    console.log(`Generating requirements for BRD ${brdId}`);

    return new Response(
      JSON.stringify({ success: true }),
      {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500 }
    );
  }
});