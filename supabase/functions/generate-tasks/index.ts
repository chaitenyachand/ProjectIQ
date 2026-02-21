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
    const { brdId, projectId, userId } = await req.json();

    if (!brdId || !projectId || !userId) {
      return new Response(
        JSON.stringify({ error: "Missing brdId, projectId, or userId" }),
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

    // Fetch the BRD data
    const { data: brd, error: brdError } = await supabase
      .from("brds")
      .select("*")
      .eq("id", brdId)
      .single();

    if (brdError || !brd) {
      throw new Error("BRD not found");
    }

    console.log("Generating tasks from BRD:", brdId);

    // Prepare requirements for task generation
    const requirements = {
      functional: brd.functional_requirements || [],
      non_functional: brd.non_functional_requirements || [],
      objectives: brd.business_objectives || [],
      timeline: brd.timeline || {},
    };

    // Call Lovable AI to generate tasks
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
            content: `You are an expert project manager who converts business requirements into executable tasks.

Analyze the provided requirements and generate a comprehensive task breakdown with dependencies.

Return a JSON object with the following structure:
{
  "tasks": [
    {
      "requirement_id": "FR-1 or NFR-1 or BO-1",
      "title": "Task title",
      "description": "Detailed task description",
      "priority": "low|medium|high|critical",
      "estimated_hours": number,
      "dependencies": ["requirement_id of dependent tasks"],
      "category": "development|design|testing|documentation|infrastructure|research"
    }
  ],
  "summary": {
    "total_tasks": number,
    "total_hours": number,
    "critical_path": ["task titles in order"]
  }
}

Guidelines:
- Break down each functional requirement into 1-3 actionable tasks
- Consider non-functional requirements as cross-cutting tasks
- Identify dependencies between tasks
- Estimate hours realistically (2-40 hours per task)
- Prioritize based on business objectives
- Group related tasks logically`
          },
          {
            role: "user",
            content: `Generate tasks from these requirements:\n\n${JSON.stringify(requirements, null, 2)}`
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

    let taskData;
    try {
      taskData = JSON.parse(content);
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      throw new Error("Failed to parse AI response");
    }

    console.log("Generated tasks:", taskData.summary);

    // Insert tasks into database
    const tasksToInsert = taskData.tasks.map((task: any, index: number) => ({
      project_id: projectId,
      brd_id: brdId,
      requirement_id: task.requirement_id,
      title: task.title,
      description: task.description,
      priority: task.priority || "medium",
      estimated_hours: task.estimated_hours || 8,
      status: "backlog",
      created_by: userId,
      dependency_depth: task.dependencies?.length || 0,
    }));

    const { data: insertedTasks, error: insertError } = await supabase
      .from("tasks")
      .insert(tasksToInsert)
      .select();

    if (insertError) {
      console.error("Task insertion error:", insertError);
      throw insertError;
    }

    // Create task dependencies
    if (insertedTasks && taskData.tasks) {
      const requirementToTaskId = new Map();
      insertedTasks.forEach((task: any, index: number) => {
        const reqId = taskData.tasks[index].requirement_id;
        requirementToTaskId.set(reqId, task.id);
      });

      const dependencies: any[] = [];
      taskData.tasks.forEach((task: any, index: number) => {
        if (task.dependencies && task.dependencies.length > 0) {
          const taskId = insertedTasks[index].id;
          task.dependencies.forEach((depReqId: string) => {
            const depTaskId = requirementToTaskId.get(depReqId);
            if (depTaskId) {
              dependencies.push({
                task_id: taskId,
                depends_on_id: depTaskId,
              });
            }
          });
        }
      });

      if (dependencies.length > 0) {
        await supabase.from("task_dependencies").insert(dependencies);
      }
    }

    console.log("Tasks created successfully:", insertedTasks?.length);

    return new Response(
      JSON.stringify({ 
        success: true, 
        tasks: insertedTasks,
        summary: taskData.summary 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error generating tasks:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});