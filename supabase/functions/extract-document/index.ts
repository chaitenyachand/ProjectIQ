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
    const { documentId, projectId } = await req.json();

    if (!documentId || !projectId) {
      return new Response(
        JSON.stringify({ error: "Missing documentId or projectId" }),
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

    console.log("Processing document:", documentId);

    // Fetch document metadata
    const { data: doc, error: docError } = await supabase
      .from("document_uploads")
      .select("*")
      .eq("id", documentId)
      .single();

    if (docError || !doc) {
      throw new Error("Document not found");
    }

    // Download the file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("documents")
      .download(doc.storage_path);

    if (downloadError) {
      console.error("Download error:", downloadError);
      throw new Error("Failed to download document");
    }

    let extractedText = "";

    // Extract text based on file type
    if (doc.file_type === "text/plain" || doc.file_name.endsWith(".txt")) {
      extractedText = await fileData.text();
    } else if (doc.file_type === "application/json" || doc.file_name.endsWith(".json")) {
      const jsonContent = await fileData.text();
      extractedText = JSON.stringify(JSON.parse(jsonContent), null, 2);
    } else {
      // For other file types, try to extract as text or use AI vision
      try {
        extractedText = await fileData.text();
      } catch {
        // If text extraction fails, we'll send to AI for processing
        const base64 = btoa(String.fromCharCode(...new Uint8Array(await fileData.arrayBuffer())));
        extractedText = `[Binary document: ${doc.file_name}]\nPlease process this document.`;
      }
    }

    // Use AI to clean and structure the extracted text
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
            content: `You are a document processing expert. Clean and structure the provided text for business requirement extraction.

Tasks:
1. Remove noise (greetings, signatures, irrelevant content)
2. Identify key sections (requirements, constraints, timelines, stakeholders)
3. Preserve important quotes for citations
4. Structure the content logically

Return a JSON object:
{
  "cleaned_text": "The processed, cleaned text",
  "sections": [
    {
      "type": "requirement|constraint|timeline|stakeholder|context|other",
      "content": "Section content",
      "original_quote": "Original text for citation",
      "confidence": 0.0-1.0
    }
  ],
  "metadata": {
    "document_type": "meeting_notes|email|specification|transcript|other",
    "key_topics": ["topic1", "topic2"],
    "identified_stakeholders": ["name1", "name2"],
    "date_references": ["date1", "date2"]
  }
}`
          },
          {
            role: "user",
            content: `Process this document:\n\nFilename: ${doc.file_name}\n\nContent:\n${extractedText.substring(0, 50000)}`
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

    let processedData;
    try {
      processedData = JSON.parse(content);
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      throw new Error("Failed to parse AI response");
    }

    // Update document with extracted text
    const { error: updateError } = await supabase
      .from("document_uploads")
      .update({
        extracted_text: processedData.cleaned_text,
        processed: true,
      })
      .eq("id", documentId);

    if (updateError) {
      console.error("Update error:", updateError);
      throw updateError;
    }

    console.log("Document processed successfully");

    return new Response(
      JSON.stringify({ 
        success: true, 
        data: processedData 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error processing document:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});