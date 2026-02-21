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
    const { projectId } = await req.json();

    if (!projectId) {
      return new Response(
        JSON.stringify({ error: "Missing projectId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("Analyzing workload for project:", projectId);

    // Fetch all active tasks
    const { data: tasks, error: tasksError } = await supabase
      .from("tasks")
      .select("*")
      .eq("project_id", projectId)
      .in("status", ["todo", "in_progress", "in_review"]);

    if (tasksError) throw tasksError;

    // Fetch completed tasks for historical analysis
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: completedTasks } = await supabase
      .from("tasks")
      .select("*")
      .eq("project_id", projectId)
      .eq("status", "done")
      .gte("completed_at", thirtyDaysAgo.toISOString());

    // Fetch project members
    const { data: members } = await supabase
      .from("project_members")
      .select("user_id, role")
      .eq("project_id", projectId);

    // Calculate workload per user
    const workloadMap: Record<string, {
      assignedTasks: number;
      completedTasks: number;
      totalEstimatedHours: number;
      overdueTask: number;
      avgCompletionTime: number;
    }> = {};

    // Initialize for all members
    members?.forEach(m => {
      workloadMap[m.user_id] = {
        assignedTasks: 0,
        completedTasks: 0,
        totalEstimatedHours: 0,
        overdueTask: 0,
        avgCompletionTime: 0,
      };
    });

    // Calculate active task metrics
    tasks?.forEach(task => {
      if (task.assignee_id) {
        if (!workloadMap[task.assignee_id]) {
          workloadMap[task.assignee_id] = {
            assignedTasks: 0,
            completedTasks: 0,
            totalEstimatedHours: 0,
            overdueTask: 0,
            avgCompletionTime: 0,
          };
        }
        workloadMap[task.assignee_id].assignedTasks++;
        workloadMap[task.assignee_id].totalEstimatedHours += task.estimated_hours || 8;
        
        if (task.deadline && new Date(task.deadline) < new Date()) {
          workloadMap[task.assignee_id].overdueTask++;
        }
      }
    });

    // Calculate completed task metrics
    completedTasks?.forEach(task => {
      if (task.assignee_id && workloadMap[task.assignee_id]) {
        workloadMap[task.assignee_id].completedTasks++;
        
        if (task.completed_at && task.created_at) {
          const completionTime = (new Date(task.completed_at).getTime() - new Date(task.created_at).getTime()) / (1000 * 60 * 60);
          workloadMap[task.assignee_id].avgCompletionTime = 
            (workloadMap[task.assignee_id].avgCompletionTime + completionTime) / 2;
        }
      }
    });

    // Calculate workload scores and store analytics
    const now = new Date();
    const periodStart = thirtyDaysAgo;
    const periodEnd = now;

    const analyticsToInsert = Object.entries(workloadMap).map(([userId, metrics]) => {
      // Workload score: 0-100, higher = more overloaded
      const workloadScore = Math.min(100, 
        (metrics.assignedTasks * 10) + 
        (metrics.overdueTask * 20) + 
        (metrics.totalEstimatedHours / 4)
      );

      return {
        project_id: projectId,
        user_id: userId,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        assigned_tasks: metrics.assignedTasks,
        completed_tasks: metrics.completedTasks,
        overdue_tasks: metrics.overdueTask,
        avg_completion_time_hours: metrics.avgCompletionTime,
        workload_score: workloadScore,
      };
    });

    // Delete old analytics for this period
    await supabase
      .from("workload_analytics")
      .delete()
      .eq("project_id", projectId)
      .gte("period_start", periodStart.toISOString());

    // Insert new analytics
    if (analyticsToInsert.length > 0) {
      await supabase.from("workload_analytics").insert(analyticsToInsert);
    }

    // Generate summary
    const summary = {
      totalActiveTasks: tasks?.length || 0,
      totalCompletedTasks: completedTasks?.length || 0,
      overloadedMembers: analyticsToInsert.filter(a => a.workload_score > 70).length,
      underutilizedMembers: analyticsToInsert.filter(a => a.workload_score < 20).length,
      averageWorkload: analyticsToInsert.reduce((sum, a) => sum + a.workload_score, 0) / (analyticsToInsert.length || 1),
      workloadByMember: analyticsToInsert,
    };

    console.log("Workload analysis complete:", summary.totalActiveTasks, "active tasks");

    return new Response(
      JSON.stringify(summary),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error analyzing workload:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});