import { useEffect, useState } from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown,
  AlertTriangle,
  Users,
  Clock,
  CheckCircle,
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Brain,
  Zap
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { cn } from '@/lib/utils';

interface TaskStats {
  total: number;
  completed: number;
  inProgress: number;
  blocked: number;
  overdue: number;
}

interface RiskTask {
  id: string;
  title: string;
  delay_risk_score: number;
  deadline: string | null;
  projects?: { name: string };
}

interface Project {
  id: string;
  name: string;
}

interface Prediction {
  task_id: string;
  delay_probability: number;
  risk_level: string;
  reasoning: string;
  recommended_action: string;
}

interface Bottleneck {
  type: string;
  severity: string;
  affected_tasks: string[];
  description: string;
  mitigation: string;
}

interface Insight {
  type: string;
  message: string;
  priority: number;
}

interface WorkloadMember {
  assignee_id: string;
  workload_score: number;
  status: string;
  tasks_count: number;
  recommendation: string;
}

export default function Analytics() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [predicting, setPredicting] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('all');
  const [taskStats, setTaskStats] = useState<TaskStats>({
    total: 0,
    completed: 0,
    inProgress: 0,
    blocked: 0,
    overdue: 0,
  });
  const [riskTasks, setRiskTasks] = useState<RiskTask[]>([]);
  const [statusData, setStatusData] = useState<{ name: string; value: number; color: string }[]>([]);
  const [priorityData, setPriorityData] = useState<{ name: string; value: number }[]>([]);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [bottlenecks, setBottlenecks] = useState<Bottleneck[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [workloadAnalysis, setWorkloadAnalysis] = useState<WorkloadMember[]>([]);

  useEffect(() => {
    fetchProjects();
  }, [user]);

  useEffect(() => {
    if (projects.length > 0 || selectedProject === 'all') {
      fetchAnalytics();
    }
  }, [selectedProject, projects]);

  async function fetchProjects() {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('projects')
        .select('id, name')
        .order('name');

      if (error) throw error;
      setProjects(data || []);
    } catch (error) {
      console.error('Error fetching projects:', error);
    }
  }

  async function fetchAnalytics() {
    if (!user) return;

    setLoading(true);
    try {
      // Fetch all tasks
      let query = supabase
        .from('tasks')
        .select('*, projects(name)');

      if (selectedProject !== 'all') {
        query = query.eq('project_id', selectedProject);
      }

      const { data: tasks, error } = await query;
      if (error) throw error;

      const now = new Date();
      const stats: TaskStats = {
        total: tasks?.length || 0,
        completed: tasks?.filter((t) => t.status === 'done').length || 0,
        inProgress: tasks?.filter((t) => t.status === 'in_progress').length || 0,
        blocked: tasks?.filter((t) => t.status === 'blocked').length || 0,
        overdue: tasks?.filter((t) => 
          t.deadline && new Date(t.deadline) < now && t.status !== 'done'
        ).length || 0,
      };
      setTaskStats(stats);

      // High risk tasks
      const highRisk = tasks
        ?.filter((t) => (t.delay_risk_score || 0) > 0.5 && t.status !== 'done')
        .sort((a, b) => (b.delay_risk_score || 0) - (a.delay_risk_score || 0))
        .slice(0, 5) || [];
      setRiskTasks(highRisk);

      // Status distribution
      const statusCounts: Record<string, number> = {};
      tasks?.forEach((t) => {
        statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
      });

      const statusColors: Record<string, string> = {
        backlog: 'hsl(var(--muted))',
        todo: 'hsl(var(--secondary))',
        in_progress: 'hsl(var(--info))',
        in_review: 'hsl(var(--warning))',
        done: 'hsl(var(--success))',
        blocked: 'hsl(var(--destructive))',
      };

      setStatusData(
        Object.entries(statusCounts).map(([name, value]) => ({
          name: name.replace('_', ' '),
          value,
          color: statusColors[name] || 'hsl(var(--muted))',
        }))
      );

      // Priority distribution
      const priorityCounts: Record<string, number> = {};
      tasks?.forEach((t) => {
        priorityCounts[t.priority] = (priorityCounts[t.priority] || 0) + 1;
      });

      setPriorityData(
        Object.entries(priorityCounts).map(([name, value]) => ({
          name: name.charAt(0).toUpperCase() + name.slice(1),
          value,
        }))
      );
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
    }
  }

  async function runPredictions() {
    if (selectedProject === 'all') {
      toast({
        variant: 'destructive',
        title: 'Select a Project',
        description: 'Please select a specific project to run predictions.',
      });
      return;
    }

    setPredicting(true);
    try {
      const { data, error } = await supabase.functions.invoke('predict-delays', {
        body: { projectId: selectedProject },
      });

      if (error) throw error;

      setPredictions(data.predictions || []);
      setBottlenecks(data.bottlenecks || []);
      setInsights(data.insights || []);
      setWorkloadAnalysis(data.workload_analysis || []);

      toast({
        title: 'Predictions Complete',
        description: `Analyzed ${data.predictions?.length || 0} tasks and found ${data.bottlenecks?.length || 0} bottlenecks.`,
      });

      // Refresh analytics to show updated scores
      fetchAnalytics();
    } catch (error: any) {
      console.error('Prediction error:', error);
      toast({
        variant: 'destructive',
        title: 'Prediction Failed',
        description: error.message,
      });
    } finally {
      setPredicting(false);
    }
  }

  const completionRate = taskStats.total > 0 
    ? Math.round((taskStats.completed / taskStats.total) * 100) 
    : 0;

  return (
    <AppLayout>
      <div className="p-6 lg:p-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Analytics & Insights</h1>
            <p className="text-muted-foreground">
              AI-powered predictions and project health metrics.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={selectedProject} onValueChange={setSelectedProject}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button 
              onClick={runPredictions} 
              disabled={predicting || selectedProject === 'all'}
            >
              {predicting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Brain className="w-4 h-4 mr-2" />
              )}
              Run AI Analysis
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* Key Metrics */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Completion Rate
                  </CardTitle>
                  <CheckCircle className="w-4 h-4 text-success" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{completionRate}%</div>
                  <Progress value={completionRate} className="mt-2 h-1.5" />
                  <p className="text-xs text-muted-foreground mt-2">
                    {taskStats.completed} of {taskStats.total} tasks completed
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    In Progress
                  </CardTitle>
                  <Clock className="w-4 h-4 text-info" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{taskStats.inProgress}</div>
                  <div className="flex items-center gap-1 mt-1">
                    <ArrowUpRight className="w-3 h-3 text-success" />
                    <span className="text-xs text-success">Active work</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Overdue Tasks
                  </CardTitle>
                  <AlertTriangle className="w-4 h-4 text-destructive" />
                </CardHeader>
                <CardContent>
                  <div className={cn(
                    "text-2xl font-bold",
                    taskStats.overdue > 0 && "text-destructive"
                  )}>
                    {taskStats.overdue}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Require immediate attention
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Blocked
                  </CardTitle>
                  <TrendingDown className="w-4 h-4 text-warning" />
                </CardHeader>
                <CardContent>
                  <div className={cn(
                    "text-2xl font-bold",
                    taskStats.blocked > 0 && "text-warning"
                  )}>
                    {taskStats.blocked}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Tasks waiting on dependencies
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* AI Insights */}
            {insights.length > 0 && (
              <Card className="border-primary/50 bg-primary/5">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Zap className="w-5 h-5 text-primary" />
                    AI Insights
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {insights.sort((a, b) => a.priority - b.priority).map((insight, index) => (
                      <div 
                        key={index}
                        className={cn(
                          "p-3 rounded-lg border",
                          insight.type === 'warning' && "bg-warning/10 border-warning/30",
                          insight.type === 'suggestion' && "bg-success/10 border-success/30",
                          insight.type === 'info' && "bg-info/10 border-info/30"
                        )}
                      >
                        <div className="flex items-start gap-2">
                          {insight.type === 'warning' && <AlertTriangle className="w-4 h-4 text-warning mt-0.5" />}
                          {insight.type === 'suggestion' && <Zap className="w-4 h-4 text-success mt-0.5" />}
                          {insight.type === 'info' && <BarChart3 className="w-4 h-4 text-info mt-0.5" />}
                          <p className="text-sm">{insight.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Bottlenecks */}
            {bottlenecks.length > 0 && (
              <Card className="border-warning/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-warning" />
                    Detected Bottlenecks
                  </CardTitle>
                  <CardDescription>
                    Issues that may slow down project progress
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {bottlenecks.map((bottleneck, index) => (
                      <div key={index} className="p-4 rounded-lg bg-secondary/50 border">
                        <div className="flex items-center justify-between mb-2">
                          <Badge variant={
                            bottleneck.severity === 'critical' ? 'destructive' :
                            bottleneck.severity === 'high' ? 'destructive' :
                            'secondary'
                          }>
                            {bottleneck.type} - {bottleneck.severity}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            Affects {bottleneck.affected_tasks.length} tasks
                          </span>
                        </div>
                        <p className="text-sm font-medium mb-1">{bottleneck.description}</p>
                        <p className="text-sm text-muted-foreground">
                          <span className="font-medium">Mitigation:</span> {bottleneck.mitigation}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Charts Row */}
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Status Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle>Task Status Distribution</CardTitle>
                  <CardDescription>
                    Overview of tasks across different stages
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {statusData.length > 0 ? (
                    <div className="h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={statusData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={100}
                            paddingAngle={2}
                            dataKey="value"
                          >
                            {statusData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: 'hsl(var(--card))',
                              border: '1px solid hsl(var(--border))',
                              borderRadius: '8px'
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                      No task data available
                    </div>
                  )}
                  <div className="flex flex-wrap gap-3 justify-center mt-4">
                    {statusData.map((item) => (
                      <div key={item.name} className="flex items-center gap-2">
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="text-sm capitalize">{item.name}</span>
                        <span className="text-sm text-muted-foreground">({item.value})</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Priority Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle>Priority Distribution</CardTitle>
                  <CardDescription>
                    Tasks grouped by priority level
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {priorityData.length > 0 ? (
                    <div className="h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={priorityData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" />
                          <YAxis stroke="hsl(var(--muted-foreground))" />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: 'hsl(var(--card))',
                              border: '1px solid hsl(var(--border))',
                              borderRadius: '8px'
                            }}
                          />
                          <Bar 
                            dataKey="value" 
                            fill="hsl(var(--primary))" 
                            radius={[4, 4, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                      No task data available
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Workload Analysis */}
            {workloadAnalysis.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    Team Workload Analysis
                  </CardTitle>
                  <CardDescription>
                    Current workload distribution across team members
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {workloadAnalysis.map((member, index) => (
                      <div key={index} className="p-4 rounded-lg bg-secondary/50 border">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                              <Users className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                              <p className="font-medium">
                                {member.assignee_id === 'unassigned' ? 'Unassigned' : `Team Member`}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {member.tasks_count} tasks assigned
                              </p>
                            </div>
                          </div>
                          <Badge className={cn(
                            member.status === 'overloaded' && "bg-destructive/20 text-destructive",
                            member.status === 'critical' && "bg-destructive text-destructive-foreground",
                            member.status === 'balanced' && "bg-success/20 text-success",
                            member.status === 'underloaded' && "bg-muted text-muted-foreground"
                          )}>
                            {member.status}
                          </Badge>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span>Workload Score</span>
                            <span className="font-medium">{member.workload_score}/100</span>
                          </div>
                          <Progress 
                            value={member.workload_score} 
                            className={cn(
                              "h-2",
                              member.workload_score > 80 && "[&>div]:bg-destructive",
                              member.workload_score > 60 && member.workload_score <= 80 && "[&>div]:bg-warning"
                            )}
                          />
                          {member.recommendation && (
                            <p className="text-xs text-muted-foreground mt-2">
                              💡 {member.recommendation}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Risk Analysis */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-warning" />
                  AI Risk Analysis
                </CardTitle>
                <CardDescription>
                  Tasks with high predicted delay probability based on ML analysis
                </CardDescription>
              </CardHeader>
              <CardContent>
                {riskTasks.length > 0 ? (
                  <div className="space-y-4">
                    {riskTasks.map((task) => {
                      const riskPercent = Math.round((task.delay_risk_score || 0) * 100);
                      const riskLevel = riskPercent >= 70 ? 'high' : riskPercent >= 50 ? 'medium' : 'low';
                      const prediction = predictions.find(p => p.task_id === task.id);
                      
                      return (
                        <div 
                          key={task.id}
                          className="flex items-center gap-4 p-4 rounded-lg bg-secondary/50"
                        >
                          <div className={cn(
                            "w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold",
                            riskLevel === 'high' && "bg-destructive/20 text-destructive",
                            riskLevel === 'medium' && "bg-warning/20 text-warning",
                            riskLevel === 'low' && "bg-muted text-muted-foreground"
                          )}>
                            {riskPercent}%
                          </div>
                          <div className="flex-1">
                            <h4 className="font-medium">{task.title}</h4>
                            <p className="text-sm text-muted-foreground">
                              {task.projects?.name}
                              {task.deadline && ` • Due: ${new Date(task.deadline).toLocaleDateString()}`}
                            </p>
                            {prediction?.reasoning && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {prediction.reasoning}
                              </p>
                            )}
                          </div>
                          <div className="text-right">
                            <Badge 
                              className={cn(
                                riskLevel === 'high' && "bg-destructive/20 text-destructive",
                                riskLevel === 'medium' && "bg-warning/20 text-warning"
                              )}
                            >
                              {riskLevel === 'high' ? 'High Risk' : 'Medium Risk'}
                            </Badge>
                            {prediction?.recommended_action && (
                              <p className="text-xs text-muted-foreground mt-1 max-w-[200px]">
                                {prediction.recommended_action}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle className="w-12 h-12 mx-auto mb-4 text-success" />
                    <h4 className="font-medium text-foreground">All Clear!</h4>
                    <p className="text-sm">No high-risk tasks detected. Your project is on track.</p>
                    {selectedProject !== 'all' && (
                      <Button 
                        variant="outline" 
                        className="mt-4"
                        onClick={runPredictions}
                        disabled={predicting}
                      >
                        {predicting ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Brain className="w-4 h-4 mr-2" />
                        )}
                        Run Analysis
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}