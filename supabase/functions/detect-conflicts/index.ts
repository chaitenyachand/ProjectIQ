import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { brdId } = await req.json();

    if (!brdId) {
      return new Response(
        JSON.stringify({ error: "Missing brdId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch BRD with all requirements
    const { data: brd, error: fetchError } = await supabase
      .from("brds")
      .select("*")
      .eq("id", brdId)
      .single();

    if (fetchError || !brd) {
      throw new Error("BRD not found");
    }

    console.log("Analyzing conflicts for BRD:", brdId);

    // Combine all requirements for analysis
    const allRequirements = [
      ...(brd.functional_requirements || []).map((r: any) => ({ ...r, type: "functional" })),
      ...(brd.non_functional_requirements || []).map((r: any) => ({ ...r, type: "non_functional" })),
      ...(brd.business_objectives || []).map((r: any) => ({ ...r, type: "objective" })),
    ];

    if (allRequirements.length < 2) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          conflicts: [],
          message: "Not enough requirements to analyze for conflicts"
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are an expert requirements analyst specializing in conflict detection.

Analyze the provided requirements and identify:
1. Direct conflicts - requirements that contradict each other
2. Resource conflicts - requirements that compete for the same resources
3. Timeline conflicts - requirements with incompatible timelines
4. Scope conflicts - requirements that have overlapping or unclear boundaries
5. Priority conflicts - requirements with misaligned priorities

Return a JSON object with:
{
  "conflicts": [
    {
      "id": "C-1",
      "type": "direct|resource|timeline|scope|priority",
      "severity": "high|medium|low",
      "requirement1_id": "FR-1",
      "requirement2_id": "FR-2",
      "description": "Clear description of the conflict",
      "recommendation": "Suggested resolution"
    }
  ],
  "summary": "Overall conflict analysis summary",
  "risk_level": "high|medium|low"
}`
          },
          {
            role: "user",
            content: `Analyze these requirements for conflicts:\n\n${JSON.stringify(allRequirements, null, 2)}`
          }
        ],
        response_format: { type: "json_object" }
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errorText);
      throw new Error("AI processing failed");
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("No content returned from AI");
    }

    let analysisResult;
    try {
      analysisResult = JSON.parse(content);
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      throw new Error("Failed to parse AI response");
    }

    console.log("Conflict analysis complete:", analysisResult.conflicts?.length || 0, "conflicts found");

    return new Response(
      JSON.stringify({ 
        success: true, 
        ...analysisResult
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error detecting conflicts:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});