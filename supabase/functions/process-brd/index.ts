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
    const { brdId, rawText } = await req.json();

    if (!brdId || !rawText) {
      return new Response(
        JSON.stringify({ error: "Missing brdId or rawText" }),
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

    console.log("Processing BRD:", brdId);

    // Call Lovable AI to extract requirements
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
            content: `You are an expert business analyst who extracts structured requirements from unstructured text.
            
Your task is to analyze the provided text and extract a complete Business Requirements Document (BRD).

Return a JSON object with the following structure:
{
  "executive_summary": "A brief summary of the project and its goals",
  "business_objectives": [
    { "id": "BO-1", "description": "Objective description", "priority": "high/medium/low", "source": "quote from text" }
  ],
  "stakeholder_analysis": [
    { "id": "SH-1", "name": "Stakeholder name/role", "interest": "Their interest in the project", "influence": "high/medium/low" }
  ],
  "functional_requirements": [
    { "id": "FR-1", "title": "Requirement title", "description": "Detailed description", "priority": "high/medium/low", "source": "quote from text" }
  ],
  "non_functional_requirements": [
    { "id": "NFR-1", "title": "Requirement title", "description": "Detailed description", "category": "security/performance/usability/etc", "source": "quote from text" }
  ],
  "assumptions": [
    { "id": "AS-1", "description": "Assumption description", "risk": "Risk if assumption is wrong" }
  ],
  "success_metrics": [
    { "id": "SM-1", "metric": "Metric name", "target": "Target value", "measurement": "How it will be measured" }
  ],
  "timeline": {
    "phases": [
      { "name": "Phase name", "duration": "Duration estimate", "deliverables": ["Deliverable 1", "Deliverable 2"] }
    ]
  }
}

Be thorough and extract as much relevant information as possible. If information is missing, make reasonable inferences and note them in the assumptions.`
          },
          {
            role: "user",
            content: `Extract requirements from the following text:\n\n${rawText}`
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

    let extractedData;
    try {
      extractedData = JSON.parse(content);
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      throw new Error("Failed to parse AI response");
    }

    console.log("Extracted data:", JSON.stringify(extractedData).substring(0, 500));

    // Update the BRD with extracted data
    const { error: updateError } = await supabase
      .from("brds")
      .update({
        executive_summary: extractedData.executive_summary || null,
        business_objectives: extractedData.business_objectives || [],
        stakeholder_analysis: extractedData.stakeholder_analysis || [],
        functional_requirements: extractedData.functional_requirements || [],
        non_functional_requirements: extractedData.non_functional_requirements || [],
        assumptions: extractedData.assumptions || [],
        success_metrics: extractedData.success_metrics || [],
        timeline: extractedData.timeline || {},
        updated_at: new Date().toISOString(),
      })
      .eq("id", brdId);

    if (updateError) {
      console.error("Database update error:", updateError);
      throw updateError;
    }

    console.log("BRD updated successfully");

    return new Response(
      JSON.stringify({ success: true, data: extractedData }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error processing BRD:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});