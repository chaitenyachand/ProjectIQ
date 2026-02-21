import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  FolderKanban, 
  FileText, 
  ListTodo, 
  AlertTriangle,
  TrendingUp,
  Clock,
  Users,
  ArrowUpRight,
  Sparkles,
  Database,
  Loader2
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface Stats {
  projects: number;
  brds: number;
  tasks: number;
  tasksCompleted: number;
  highRiskTasks: number;
}

export default function Dashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [stats, setStats] = useState<Stats>({
    projects: 0,
    brds: 0,
    tasks: 0,
    tasksCompleted: 0,
    highRiskTasks: 0,
  });
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  async function handleSeedDemoData() {
    setSeeding(true);
    try {
      const { data, error } = await supabase.functions.invoke('seed-demo-data');
      if (error) throw error;
      toast({
        title: 'Demo Data Loaded!',
        description: `Created ${data.summary.projects} projects, ${data.summary.brds} BRDs, and ${data.summary.tasks} tasks.`,
      });
      // Refresh stats
      window.location.reload();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to seed demo data',
      });
    } finally {
      setSeeding(false);
    }
  }

  useEffect(() => {
    async function fetchStats() {
      if (!user) return;

      try {
        // Fetch projects count
        const { count: projectsCount } = await supabase
          .from('projects')
          .select('*', { count: 'exact', head: true });

        // Fetch BRDs count
        const { count: brdsCount } = await supabase
          .from('brds')
          .select('*', { count: 'exact', head: true });

        // Fetch tasks
        const { data: tasksData } = await supabase
          .from('tasks')
          .select('status, delay_risk_score');

        const tasksCompleted = tasksData?.filter(t => t.status === 'done').length || 0;
        const highRiskTasks = tasksData?.filter(t => (t.delay_risk_score || 0) > 0.7).length || 0;

        setStats({
          projects: projectsCount || 0,
          brds: brdsCount || 0,
          tasks: tasksData?.length || 0,
          tasksCompleted,
          highRiskTasks,
        });
      } catch (error) {
        console.error('Error fetching stats:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, [user]);

  const taskProgress = stats.tasks > 0 ? (stats.tasksCompleted / stats.tasks) * 100 : 0;

  const quickActions = [
    { 
      title: 'New Project', 
      description: 'Create a new project workspace',
      href: '/projects/new',
      icon: FolderKanban,
      color: 'text-primary'
    },
    { 
      title: 'Generate BRD', 
      description: 'Extract requirements from documents',
      href: '/brd/new',
      icon: FileText,
      color: 'text-success'
    },
    { 
      title: 'View Tasks', 
      description: 'Manage and track task progress',
      href: '/tasks',
      icon: ListTodo,
      color: 'text-warning'
    },
  ];

  return (
    <AppLayout>
      <div className="p-6 lg:p-8 space-y-8">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground">
              Welcome back! Here's an overview of your projects.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {stats.projects === 0 && (
              <Button 
                variant="outline" 
                onClick={handleSeedDemoData} 
                disabled={seeding}
                className="border-primary/30 hover:bg-primary/10"
              >
                {seeding ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Database className="w-4 h-4 mr-2" />
                )}
                {seeding ? 'Loading...' : 'Load Demo Data'}
              </Button>
            )}
            <Button asChild>
              <Link to="/brd/new">
                <Sparkles className="w-4 h-4 mr-2" />
                Generate BRD
              </Link>
            </Button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="card-interactive">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Projects
              </CardTitle>
              <FolderKanban className="w-4 h-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.projects}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Active workspaces
              </p>
            </CardContent>
          </Card>

          <Card className="card-interactive">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                BRD Documents
              </CardTitle>
              <FileText className="w-4 h-4 text-success" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.brds}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Generated documents
              </p>
            </CardContent>
          </Card>

          <Card className="card-interactive">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Task Progress
              </CardTitle>
              <ListTodo className="w-4 h-4 text-info" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {stats.tasksCompleted}/{stats.tasks}
              </div>
              <Progress value={taskProgress} className="mt-2 h-1.5" />
            </CardContent>
          </Card>

          <Card className="card-interactive">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                At-Risk Tasks
              </CardTitle>
              <AlertTriangle className="w-4 h-4 text-warning" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-warning">{stats.highRiskTasks}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Potential delays detected
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions & Insights */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>
                Jump into your most common workflows
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {quickActions.map((action) => (
                <Link
                  key={action.title}
                  to={action.href}
                  className="flex items-center gap-4 p-4 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors group"
                >
                  <div className={`p-2.5 rounded-lg bg-background ${action.color}`}>
                    <action.icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium">{action.title}</h3>
                    <p className="text-sm text-muted-foreground">{action.description}</p>
                  </div>
                  <ArrowUpRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </Link>
              ))}
            </CardContent>
          </Card>

          {/* AI Insights */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                AI Insights
              </CardTitle>
              <CardDescription>
                Intelligent predictions and recommendations
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {stats.highRiskTasks > 0 ? (
                <div className="p-4 rounded-lg bg-warning/10 border border-warning/20">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-warning mt-0.5" />
                    <div>
                      <h4 className="font-medium text-warning">Delay Risk Detected</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        {stats.highRiskTasks} task(s) have a high probability of delay. 
                        Consider reassigning or extending deadlines.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-lg bg-success/10 border border-success/20">
                  <div className="flex items-start gap-3">
                    <TrendingUp className="w-5 h-5 text-success mt-0.5" />
                    <div>
                      <h4 className="font-medium text-success">On Track</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        All tasks are progressing well. No immediate risks detected.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="p-4 rounded-lg bg-secondary/50">
                <div className="flex items-start gap-3">
                  <Clock className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div>
                    <h4 className="font-medium">Productivity Tip</h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      Upload your meeting notes or documents to the BRD workspace 
                      to automatically extract requirements.
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-secondary/50">
                <div className="flex items-start gap-3">
                  <Users className="w-5 h-5 text-muted-foreground mt-0.5" />
                  <div>
                    <h4 className="font-medium">Team Collaboration</h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      Invite team members to your projects for real-time collaboration 
                      on requirements and tasks.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}