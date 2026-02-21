import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    console.log("Filtering", sources.length, "sources for project relevance");

    // Prepare sources for filtering
    const sourceSummaries = sources.map((s: any, idx: number) => ({
      index: idx,
      type: s.type || 'unknown',
      preview: typeof s.content === 'string' 
        ? s.content.substring(0, 500) 
        : JSON.stringify(s).substring(0, 500),
      metadata: s.metadata || {}
    }));

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
            content: `You are an expert at filtering communication data for business requirements extraction.

Your job is to analyze incoming sources (emails, meeting transcripts, Slack messages, documents) and:
1. Identify which sources contain project-relevant information
2. Filter out noise (greetings, small talk, off-topic discussions, spam)
3. Categorize the relevant content

For each source, determine:
- relevance_score: 0.0 to 1.0 (how relevant to business requirements)
- contains_requirements: boolean (contains actual requirements or decisions)
- contains_decisions: boolean (contains stakeholder decisions)
- contains_timeline: boolean (contains timeline/deadline info)
- contains_concerns: boolean (contains risks or concerns)
- category: "requirements" | "decisions" | "feedback" | "timeline" | "stakeholder_input" | "noise"
- reason: brief explanation for the categorization

Return JSON:
{
  "filtered_sources": [
    {
      "index": 0,
      "relevance_score": 0.85,
      "contains_requirements": true,
      "contains_decisions": false,
      "contains_timeline": true,
      "contains_concerns": false,
      "category": "requirements",
      "reason": "Contains specific feature requirements and deadline",
      "key_topics": ["feature X", "deadline"]
    }
  ],
  "statistics": {
    "total_sources": 10,
    "relevant_sources": 7,
    "noise_filtered": 3,
    "requirements_found": 5,
    "decisions_found": 2
  }
}`
          },
          {
            role: "user",
            content: `${projectContext ? `Project context: ${projectContext}\n\n` : ''}Analyze and filter these sources:\n\n${JSON.stringify(sourceSummaries, null, 2)}`
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

    let filterResult;
    try {
      filterResult = JSON.parse(content);
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      throw new Error("Failed to parse AI response");
    }

    // Enrich filtered sources with original content
    const enrichedSources = filterResult.filtered_sources
      .filter((f: any) => f.relevance_score > 0.3)
      .map((f: any) => ({
        ...f,
        original: sources[f.index]
      }));

    console.log("Filtering complete:", filterResult.statistics);

    return new Response(
      JSON.stringify({ 
        success: true, 
        filtered_sources: enrichedSources,
        statistics: filterResult.statistics
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error filtering sources:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
