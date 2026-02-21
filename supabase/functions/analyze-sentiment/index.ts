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
    const { brdId, sources } = await req.json();

    if (!brdId && !sources) {
      return new Response(
        JSON.stringify({ error: "Missing brdId or sources" }),
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

    let rawSources = sources;

    // If brdId provided, fetch sources from BRD
    if (brdId && !sources) {
      const { data: brd, error: fetchError } = await supabase
        .from("brds")
        .select("raw_sources, stakeholder_analysis")
        .eq("id", brdId)
        .single();

      if (fetchError || !brd) {
        throw new Error("BRD not found");
      }
      rawSources = brd.raw_sources || [];
    }

    console.log("Analyzing sentiment for", rawSources.length, "sources");

    if (!rawSources || rawSources.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          sentiment: {
            overall: "neutral",
            score: 0.5,
            stakeholders: [],
            concerns: [],
            positive_signals: []
          },
          message: "No sources to analyze"
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Prepare source content for analysis
    const sourceText = rawSources.map((s: any) => {
      if (typeof s === 'string') return s;
      if (s.content) return `[${s.type || 'text'}] ${s.content}`;
      return JSON.stringify(s);
    }).join('\n\n---\n\n');

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
            content: `You are an expert at analyzing stakeholder sentiment from business communications.

Analyze the provided sources and extract:
1. Overall sentiment (positive, neutral, negative, mixed)
2. Sentiment score (0.0 to 1.0 where 0 is very negative, 1 is very positive)
3. Per-stakeholder sentiment if identifiable
4. Key concerns expressed
5. Positive signals and support indicators
6. Urgency level detected
7. Confidence/uncertainty signals

Return a JSON object:
{
  "overall": "positive|neutral|negative|mixed",
  "score": 0.75,
  "urgency": "high|medium|low",
  "confidence_level": "high|medium|low",
  "stakeholders": [
    {
      "name": "Stakeholder name or role",
      "sentiment": "positive|neutral|negative",
      "key_concerns": ["Concern 1"],
      "supportive_of": ["Feature or requirement they support"]
    }
  ],
  "concerns": [
    {
      "concern": "Description of concern",
      "mentioned_by": "Stakeholder or 'multiple'",
      "severity": "high|medium|low",
      "quote": "Relevant quote if available"
    }
  ],
  "positive_signals": [
    {
      "signal": "Description of positive indicator",
      "mentioned_by": "Stakeholder",
      "quote": "Relevant quote"
    }
  ],
  "recommendations": ["Action recommendations based on sentiment"]
}`
          },
          {
            role: "user",
            content: `Analyze the sentiment in these communications:\n\n${sourceText}`
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

    let sentimentResult;
    try {
      sentimentResult = JSON.parse(content);
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      throw new Error("Failed to parse AI response");
    }

    console.log("Sentiment analysis complete:", sentimentResult.overall, "with score", sentimentResult.score);

    return new Response(
      JSON.stringify({ 
        success: true, 
        sentiment: sentimentResult
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error analyzing sentiment:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});