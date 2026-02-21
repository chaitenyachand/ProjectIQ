import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface TaskMetrics {
  avgCompletionTime: number;
  completionRate: number;
  overdueRate: number;
  assigneeWorkload: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { projectId, taskIds } = await req.json();

    if (!projectId) {
      return new Response(
        JSON.stringify({ error: "Missing projectId" }),
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

    console.log("Predicting delays for project:", projectId);

    // Fetch tasks for analysis
    let tasksQuery = supabase
      .from("tasks")
      .select("*")
      .eq("project_id", projectId)
      .in("status", ["backlog", "todo", "in_progress", "in_review"]);

    if (taskIds && taskIds.length > 0) {
      tasksQuery = tasksQuery.in("id", taskIds);
    }

    const { data: tasks, error: tasksError } = await tasksQuery;

    if (tasksError) throw tasksError;
    if (!tasks || tasks.length === 0) {
      return new Response(
        JSON.stringify({ predictions: [], insights: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch historical completed tasks for learning
    const { data: completedTasks } = await supabase
      .from("tasks")
      .select("*")
      .eq("project_id", projectId)
      .eq("status", "done")
      .not("completed_at", "is", null);

    // Fetch task events for pattern analysis
    const { data: taskEvents } = await supabase
      .from("task_events")
      .select("*")
      .in("task_id", tasks.map(t => t.id))
      .order("created_at", { ascending: false })
      .limit(500);

    // Fetch dependencies
    const { data: dependencies } = await supabase
      .from("task_dependencies")
      .select("*")
      .in("task_id", tasks.map(t => t.id));

    // Calculate historical metrics
    const historicalMetrics = calculateHistoricalMetrics(completedTasks || []);
    
    // Calculate workload per assignee
    const workloadByAssignee = calculateWorkload(tasks);

    // Prepare context for AI analysis
    const analysisContext = {
      tasks: tasks.map(t => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        status: t.status,
        deadline: t.deadline,
        estimated_hours: t.estimated_hours,
        assignee_id: t.assignee_id,
        dependency_depth: t.dependency_depth,
        created_at: t.created_at,
      })),
      historical_metrics: historicalMetrics,
      workload: workloadByAssignee,
      dependencies: dependencies || [],
      event_patterns: analyzeEventPatterns(taskEvents || []),
    };

    // Call AI for intelligent predictions
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
            content: `You are an ML-powered project analytics engine that predicts task delays and identifies bottlenecks.

Analyze the provided task data and historical metrics to generate predictions.

Return a JSON object:
{
  "predictions": [
    {
      "task_id": "uuid",
      "delay_probability": 0.0-1.0,
      "risk_level": "low|medium|high",
      "reasoning": "Brief explanation",
      "recommended_action": "Suggested action"
    }
  ],
  "workload_analysis": [
    {
      "assignee_id": "uuid or null",
      "workload_score": 0-100,
      "status": "underloaded|balanced|overloaded|critical",
      "tasks_count": number,
      "recommendation": "Suggestion"
    }
  ],
  "bottlenecks": [
    {
      "type": "dependency|resource|deadline",
      "severity": "low|medium|high|critical",
      "affected_tasks": ["task_ids"],
      "description": "What the bottleneck is",
      "mitigation": "How to resolve it"
    }
  ],
  "insights": [
    {
      "type": "warning|info|suggestion",
      "message": "Actionable insight",
      "priority": 1-5
    }
  ]
}

Consider:
- Task dependencies and critical path
- Historical completion patterns
- Current workload distribution
- Deadline proximity
- Priority vs. resource allocation`
          },
          {
            role: "user",
            content: `Analyze this project data:\n\n${JSON.stringify(analysisContext, null, 2)}`
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

    let predictions;
    try {
      predictions = JSON.parse(content);
    } catch (parseError) {
      console.error("Failed to parse AI response:", content);
      throw new Error("Failed to parse AI response");
    }

    // Store predictions in database
    if (predictions.predictions && predictions.predictions.length > 0) {
      const predictionsToInsert = predictions.predictions.map((p: any) => ({
        task_id: p.task_id,
        prediction_type: "delay_risk",
        probability: p.delay_probability,
        risk_level: p.risk_level,
        reasoning: p.reasoning,
      }));

      // Delete old predictions for these tasks
      await supabase
        .from("predictions")
        .delete()
        .in("task_id", predictionsToInsert.map((p: any) => p.task_id));

      await supabase.from("predictions").insert(predictionsToInsert);

      // Update delay_risk_score on tasks
      for (const pred of predictions.predictions) {
        await supabase
          .from("tasks")
          .update({ delay_risk_score: pred.delay_probability })
          .eq("id", pred.task_id);
      }
    }

    console.log("Predictions generated:", predictions.predictions?.length);

    return new Response(
      JSON.stringify(predictions),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error predicting delays:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function calculateHistoricalMetrics(completedTasks: any[]): TaskMetrics {
  if (completedTasks.length === 0) {
    return {
      avgCompletionTime: 0,
      completionRate: 0,
      overdueRate: 0,
      assigneeWorkload: 0,
    };
  }

  let totalCompletionTime = 0;
  let overdueCount = 0;

  completedTasks.forEach(task => {
    if (task.completed_at && task.created_at) {
      const completionTime = new Date(task.completed_at).getTime() - new Date(task.created_at).getTime();
      totalCompletionTime += completionTime / (1000 * 60 * 60); // hours
    }
    if (task.deadline && task.completed_at && new Date(task.completed_at) > new Date(task.deadline)) {
      overdueCount++;
    }
  });

  return {
    avgCompletionTime: totalCompletionTime / completedTasks.length,
    completionRate: completedTasks.length,
    overdueRate: overdueCount / completedTasks.length,
    assigneeWorkload: 0,
  };
}

function calculateWorkload(tasks: any[]): Record<string, number> {
  const workload: Record<string, number> = {};
  
  tasks.forEach(task => {
    const assignee = task.assignee_id || "unassigned";
    workload[assignee] = (workload[assignee] || 0) + (task.estimated_hours || 8);
  });

  return workload;
}

function analyzeEventPatterns(events: any[]): any {
  const statusChanges: Record<string, number> = {};
  const avgTimeInStatus: Record<string, number> = {};

  events.forEach(event => {
    if (event.event_type === "update" && event.new_value?.status) {
      const status = event.new_value.status;
      statusChanges[status] = (statusChanges[status] || 0) + 1;
    }
  });

  return {
    statusChanges,
    totalEvents: events.length,
  };
}