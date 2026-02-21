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
    const { brdId, instruction, section } = await req.json();

    if (!brdId || !instruction) {
      return new Response(
        JSON.stringify({ error: "Missing brdId or instruction" }),
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

    // Fetch current BRD
    const { data: brd, error: fetchError } = await supabase
      .from("brds")
      .select("*")
      .eq("id", brdId)
      .single();

    if (fetchError || !brd) {
      throw new Error("BRD not found");
    }

    console.log("Processing NL edit:", instruction, "for section:", section || "all");

    // Prepare context based on section
    let currentContent: any = {};
    if (section === "executive_summary") {
      currentContent = { executive_summary: brd.executive_summary };
    } else if (section === "business_objectives") {
      currentContent = { business_objectives: brd.business_objectives };
    } else if (section === "functional_requirements") {
      currentContent = { functional_requirements: brd.functional_requirements };
    } else if (section === "non_functional_requirements") {
      currentContent = { non_functional_requirements: brd.non_functional_requirements };
    } else if (section === "stakeholder_analysis") {
      currentContent = { stakeholder_analysis: brd.stakeholder_analysis };
    } else if (section === "assumptions") {
      currentContent = { assumptions: brd.assumptions };
    } else if (section === "success_metrics") {
      currentContent = { success_metrics: brd.success_metrics };
    } else if (section === "timeline") {
      currentContent = { timeline: brd.timeline };
    } else {
      // Full document edit
      currentContent = {
        executive_summary: brd.executive_summary,
        business_objectives: brd.business_objectives,
        stakeholder_analysis: brd.stakeholder_analysis,
        functional_requirements: brd.functional_requirements,
        non_functional_requirements: brd.non_functional_requirements,
        assumptions: brd.assumptions,
        success_metrics: brd.success_metrics,
        timeline: brd.timeline,
      };
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
            content: `You are an expert business analyst editing a Business Requirements Document.
            
You will receive the current content of the BRD (or a specific section) and an instruction from the user.
Apply the instruction to modify the content while:
1. Maintaining professional business language
2. Preserving the structure and format of the data
3. Keeping citations/sources intact where applicable
4. Ensuring requirements remain clear and actionable

Return ONLY the modified content in the same JSON structure as provided.
Do not add explanations - just return the modified JSON.`
          },
          {
            role: "user",
            content: `Current BRD content:\n${JSON.stringify(currentContent, null, 2)}\n\nInstruction: ${instruction}\n\nReturn the modified content in the same JSON format.`
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

    let modifiedContent;
    try {
      modifiedContent = JSON.parse(content);
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      throw new Error("Failed to parse AI response");
    }

    // Create version history before update
    const { error: versionError } = await supabase
      .from("brd_versions")
      .insert({
        brd_id: brdId,
        version: brd.version,
        content: {
          executive_summary: brd.executive_summary,
          business_objectives: brd.business_objectives,
          stakeholder_analysis: brd.stakeholder_analysis,
          functional_requirements: brd.functional_requirements,
          non_functional_requirements: brd.non_functional_requirements,
          assumptions: brd.assumptions,
          success_metrics: brd.success_metrics,
          timeline: brd.timeline,
        },
        edited_by: brd.created_by,
        edit_note: `NL Edit: ${instruction}`,
      });

    if (versionError) {
      console.error("Version history error:", versionError);
    }

    // Update BRD with modified content
    const updateData: any = {
      version: brd.version + 1,
      updated_at: new Date().toISOString(),
    };

    // Apply only the modified sections
    Object.keys(modifiedContent).forEach((key) => {
      if (modifiedContent[key] !== undefined) {
        updateData[key] = modifiedContent[key];
      }
    });

    const { error: updateError } = await supabase
      .from("brds")
      .update(updateData)
      .eq("id", brdId);

    if (updateError) {
      console.error("Database update error:", updateError);
      throw updateError;
    }

    console.log("BRD updated successfully via NL edit");

    return new Response(
      JSON.stringify({ 
        success: true, 
        data: modifiedContent,
        instruction,
        newVersion: brd.version + 1
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error processing NL edit:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});