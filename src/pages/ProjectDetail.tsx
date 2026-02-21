import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  FolderKanban,
  FileText,
  ListTodo,
  Calendar,
  ArrowLeft,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow, format } from 'date-fns';
import { cn } from '@/lib/utils';

interface ProjectData {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface BRD {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  deadline: string | null;
  created_at: string;
}

const statusColors: Record<string, string> = {
  draft: 'bg-slate-600 text-slate-100',
  in_review: 'bg-amber-600 text-amber-100',
  approved: 'bg-emerald-600 text-emerald-100',
  archived: 'bg-gray-600 text-gray-100',
  backlog: 'bg-slate-600 text-slate-100',
  todo: 'bg-slate-500 text-slate-100',
  in_progress: 'bg-blue-600 text-blue-100',
  done: 'bg-emerald-600 text-emerald-100',
  blocked: 'bg-red-600 text-red-100',
};

const priorityColors: Record<string, string> = {
  low: 'priority-low',
  medium: 'priority-medium',
  high: 'priority-high',
  critical: 'priority-critical',
};

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [project, setProject] = useState<ProjectData | null>(null);
  const [brds, setBrds] = useState<BRD[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user && id) fetchProjectData();
  }, [user, id]);

  async function fetchProjectData() {
    try {
      const [projectRes, brdsRes, tasksRes] = await Promise.all([
        supabase.from('projects').select('*').eq('id', id!).single(),
        supabase.from('brds').select('id, title, status, created_at, updated_at').eq('project_id', id!).order('updated_at', { ascending: false }),
        supabase.from('tasks').select('id, title, status, priority, deadline, created_at').eq('project_id', id!).order('created_at', { ascending: false }),
      ]);

      if (projectRes.error) throw projectRes.error;
      setProject(projectRes.data);
      setBrds(brdsRes.data || []);
      setTasks(tasksRes.data || []);
    } catch (error) {
      console.error('Error fetching project:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (!project) {
    return (
      <AppLayout>
        <div className="p-6 lg:p-8 text-center py-24">
          <h2 className="text-xl font-semibold mb-2">Project not found</h2>
          <Button asChild variant="outline">
            <Link to="/projects"><ArrowLeft className="w-4 h-4 mr-2" />Back to Projects</Link>
          </Button>
        </div>
      </AppLayout>
    );
  }

  const taskStats = {
    total: tasks.length,
    done: tasks.filter(t => t.status === 'done').length,
    inProgress: tasks.filter(t => t.status === 'in_progress').length,
    blocked: tasks.filter(t => t.status === 'blocked').length,
  };

  return (
    <AppLayout>
      <div className="p-6 lg:p-8 space-y-6">
        {/* Header */}
        <div className="flex items-start gap-4">
          <Button asChild variant="ghost" size="icon">
            <Link to="/projects"><ArrowLeft className="w-5 h-5" /></Link>
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <FolderKanban className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
                <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Calendar className="w-3 h-3" />
                  Updated {formatDistanceToNow(new Date(project.updated_at), { addSuffix: true })}
                </p>
              </div>
            </div>
            {project.description && (
              <p className="text-muted-foreground mt-3 max-w-2xl">{project.description}</p>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          {[
            { label: 'Total Tasks', value: taskStats.total, icon: ListTodo },
            { label: 'Completed', value: taskStats.done, icon: ListTodo },
            { label: 'In Progress', value: taskStats.inProgress, icon: ListTodo },
            { label: 'BRDs', value: brds.length, icon: FileText },
          ].map((stat) => (
            <Card key={stat.label}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <stat.icon className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* BRDs */}
        <div>
          <h2 className="text-lg font-semibold mb-3">Business Requirements</h2>
          {brds.length === 0 ? (
            <Card className="p-6 text-center text-muted-foreground">No BRDs yet</Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {brds.map((brd) => (
                <Card key={brd.id} className="card-interactive">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <Link to={`/brd/${brd.id}`} className="font-medium hover:text-primary transition-colors">
                        {brd.title}
                      </Link>
                      <Badge className={cn('text-xs', statusColors[brd.status] || '')}>
                        {brd.status.replace('_', ' ')}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Updated {formatDistanceToNow(new Date(brd.updated_at), { addSuffix: true })}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Tasks */}
        <div>
          <h2 className="text-lg font-semibold mb-3">Tasks</h2>
          {tasks.length === 0 ? (
            <Card className="p-6 text-center text-muted-foreground">No tasks yet</Card>
          ) : (
            <div className="space-y-2">
              {tasks.map((task) => (
                <Card key={task.id} className="card-interactive">
                  <CardContent className="p-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-medium text-sm truncate">{task.title}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Badge className={cn('text-xs', priorityColors[task.priority] || '')}>
                        {task.priority}
                      </Badge>
                      <Badge className={cn('text-xs', statusColors[task.status] || '')}>
                        {task.status.replace('_', ' ')}
                      </Badge>
                      {task.deadline && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {format(new Date(task.deadline), 'MMM d')}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
