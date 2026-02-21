import { useEffect, useState } from 'react';
import {
  ListTodo, Plus, Search, Loader2, Calendar,
  AlertTriangle, MoreHorizontal, ExternalLink, Share2,
  CheckSquare, Trello, BookOpen, Zap
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui/tabs';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const PYTHON_BACKEND = import.meta.env.VITE_PYTHON_BACKEND_URL || 'http://localhost:8000';

type TaskStatus   = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked';
type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  actual_hours: number | null;
  estimated_hours: number | null;
  deadline: string | null;
  delay_risk_score: number | null;
  project_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  brd_id: string | null;
  requirement_id: string | null;
  dependency_depth: number | null;
  assignee_id: string | null;
  jira_issue_key?: string | null;
  jira_issue_url?: string | null;
  projects?: { name: string };
}

interface Project { id: string; name: string; }

const statusColumns: { status: TaskStatus; label: string; color: string; badgeColor: string }[] = [
  { status: 'backlog',     label: 'Backlog',      color: 'bg-slate-800/50',    badgeColor: 'bg-slate-600 text-slate-100' },
  { status: 'todo',        label: 'To Do',        color: 'bg-slate-700/50',    badgeColor: 'bg-slate-500 text-slate-100' },
  { status: 'in_progress', label: 'In Progress',  color: 'bg-blue-900/40',     badgeColor: 'bg-blue-600 text-blue-100' },
  { status: 'in_review',   label: 'In Review',    color: 'bg-amber-900/40',    badgeColor: 'bg-amber-600 text-amber-100' },
  { status: 'done',        label: 'Done',         color: 'bg-emerald-900/40',  badgeColor: 'bg-emerald-600 text-emerald-100' },
];

const priorityConfig: Record<TaskPriority, { label: string; className: string }> = {
  low:      { label: 'Low',      className: 'priority-low' },
  medium:   { label: 'Medium',   className: 'priority-medium' },
  high:     { label: 'High',     className: 'priority-high' },
  critical: { label: 'Critical', className: 'priority-critical' },
};

// ── Export platform configs ───────────────────────────────────────────────────
const EXPORT_PLATFORMS = [
  {
    id:    'jira',
    name:  'Jira',
    icon:  CheckSquare,
    color: 'text-blue-500',
    bg:    'bg-blue-500/10',
    description: 'Export as Stories to your Jira project',
    requiresConfig: true,
  },
  {
    id:    'linear',
    name:  'Linear',
    icon:  Zap,
    color: 'text-purple-500',
    bg:    'bg-purple-500/10',
    description: 'Create issues in Linear',
    requiresConfig: true,
  },
  {
    id:    'trello',
    name:  'Trello',
    icon:  Trello,
    color: 'text-sky-500',
    bg:    'bg-sky-500/10',
    description: 'Add cards to a Trello board',
    requiresConfig: true,
  },
  {
    id:    'notion',
    name:  'Notion',
    icon:  BookOpen,
    color: 'text-slate-400',
    bg:    'bg-slate-500/10',
    description: 'Create tasks in a Notion database',
    requiresConfig: true,
  },
];

export default function Tasks() {
  const { user }  = useAuth();
  const { toast } = useToast();

  const [tasks, setTasks]         = useState<Task[]>([]);
  const [projects, setProjects]   = useState<Project[]>([]);
  const [loading, setLoading]     = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [dialogOpen, setDialogOpen]   = useState(false);
  const [creating, setCreating]       = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [detailOpen, setDetailOpen]     = useState(false);
  const [exportOpen, setExportOpen]     = useState(false);
  const [exporting, setExporting]       = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<string>('jira');
  const [exportConfig, setExportConfig] = useState({
    jira_base_url:   '',
    jira_email:      '',
    jira_api_token:  '',
    jira_project_key:'',
    linear_api_key:  '',
    linear_team_id:  '',
    trello_api_key:  '',
    trello_token:    '',
    trello_list_id:  '',
    notion_token:    '',
    notion_db_id:    '',
  });
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());

  const [newTask, setNewTask] = useState({
    title: '', description: '', projectId: '',
    priority: 'medium' as TaskPriority, deadline: '',
  });

  useEffect(() => { fetchData(); }, [user]);

  async function fetchData() {
    if (!user) return;
    try {
      const [tasksRes, projRes] = await Promise.all([
        supabase.from('tasks').select('*, projects(name)').order('created_at', { ascending: false }),
        supabase.from('projects').select('id, name').order('name'),
      ]);
      if (tasksRes.error) throw tasksRes.error;
      if (projRes.error)  throw projRes.error;
      setTasks(tasksRes.data ?? []);
      setProjects(projRes.data ?? []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function handleCreateTask() {
    if (!user || !newTask.title.trim() || !newTask.projectId) return;
    setCreating(true);
    try {
      const { error } = await supabase.from('tasks').insert({
        title:       newTask.title.trim(),
        description: newTask.description.trim() || null,
        project_id:  newTask.projectId,
        priority:    newTask.priority,
        deadline:    newTask.deadline || null,
        created_by:  user.id,
        status:      'backlog',
      });
      if (error) throw error;
      toast({ title: 'Task Created', description: 'Added to backlog.' });
      setDialogOpen(false);
      setNewTask({ title: '', description: '', projectId: '', priority: 'medium', deadline: '' });
      fetchData();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally { setCreating(false); }
  }

  async function updateTaskStatus(taskId: string, newStatus: TaskStatus) {
    try {
      const { error } = await supabase.from('tasks').update({
        status: newStatus,
        completed_at: newStatus === 'done' ? new Date().toISOString() : null,
      }).eq('id', taskId);
      if (error) throw error;
      fetchData();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    }
  }

  async function handleDeleteTask(taskId: string) {
    try {
      const { error } = await supabase.from('tasks').delete().eq('id', taskId);
      if (error) throw error;
      toast({ title: 'Task Deleted' });
      fetchData();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    }
  }

  // ── Export tasks to external platform ────────────────────────────────────
  async function handleExport() {
    if (!user) return;
    const taskIds = selectedTaskIds.size > 0
      ? Array.from(selectedTaskIds)
      : filteredTasks.map(t => t.id);

    if (taskIds.length === 0) {
      toast({ variant: 'destructive', title: 'No tasks selected' });
      return;
    }

    setExporting(true);
    try {
      if (selectedPlatform === 'jira') {
        // 1. Connect Jira if not already
        const connectResp = await fetch(`${PYTHON_BACKEND}/api/integrations/jira/connect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id:   user.id,
            base_url:  exportConfig.jira_base_url,
            email:     exportConfig.jira_email,
            api_token: exportConfig.jira_api_token,
          }),
        });
        if (!connectResp.ok) {
          const err = await connectResp.json();
          throw new Error(err.detail ?? 'Jira connection failed');
        }

        // 2. Sync tasks
        const syncResp = await fetch(`${PYTHON_BACKEND}/api/integrations/jira/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id:     user.id,
            task_ids:    taskIds,
            project_key: exportConfig.jira_project_key,
          }),
        });
        const result = await syncResp.json();
        toast({
          title: 'Exported to Jira',
          description: `${result.synced} task${result.synced !== 1 ? 's' : ''} created in Jira. ${result.failed > 0 ? `${result.failed} failed.` : ''}`,
        });
        fetchData();

      } else if (selectedPlatform === 'linear') {
        await exportToLinear(taskIds);
      } else if (selectedPlatform === 'trello') {
        await exportToTrello(taskIds);
      } else if (selectedPlatform === 'notion') {
        await exportToNotion(taskIds);
      }

      setExportOpen(false);
      setSelectedTaskIds(new Set());
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Export Failed', description: e.message });
    } finally {
      setExporting(false);
    }
  }

  async function exportToLinear(taskIds: string[]) {
    const tasksToExport = tasks.filter(t => taskIds.includes(t.id));
    const results: { name: string; url: string }[] = [];

    for (const task of tasksToExport) {
      const resp = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': exportConfig.linear_api_key,
        },
        body: JSON.stringify({
          query: `
            mutation CreateIssue($input: IssueCreateInput!) {
              issueCreate(input: $input) { issue { id title url } }
            }
          `,
          variables: {
            input: {
              teamId:      exportConfig.linear_team_id,
              title:       task.title,
              description: task.description ?? '',
              priority:    { low: 4, medium: 3, high: 2, critical: 1 }[task.priority] ?? 3,
            },
          },
        }),
      });
      const data = await resp.json();
      const issue = data?.data?.issueCreate?.issue;
      if (issue) results.push({ name: task.title, url: issue.url });
    }

    toast({ title: 'Exported to Linear', description: `${results.length} issues created.` });
  }

  async function exportToTrello(taskIds: string[]) {
    const tasksToExport = tasks.filter(t => taskIds.includes(t.id));
    let created = 0;

    for (const task of tasksToExport) {
      const url = `https://api.trello.com/1/cards?key=${exportConfig.trello_api_key}&token=${exportConfig.trello_token}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idList: exportConfig.trello_list_id,
          name:   task.title,
          desc:   task.description ?? '',
          due:    task.deadline ?? null,
        }),
      });
      if (resp.ok) created++;
    }
    toast({ title: 'Exported to Trello', description: `${created} cards created.` });
  }

  async function exportToNotion(taskIds: string[]) {
    const tasksToExport = tasks.filter(t => taskIds.includes(t.id));
    let created = 0;

    for (const task of tasksToExport) {
      const resp = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization':  `Bearer ${exportConfig.notion_token}`,
          'Content-Type':   'application/json',
          'Notion-Version': '2022-06-28',
        },
        body: JSON.stringify({
          parent: { database_id: exportConfig.notion_db_id },
          properties: {
            Name:     { title: [{ text: { content: task.title } }] },
            Status:   { select: { name: task.status } },
            Priority: { select: { name: task.priority } },
          },
        }),
      });
      if (resp.ok) created++;
    }
    toast({ title: 'Exported to Notion', description: `${created} pages created.` });
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  const filteredTasks   = tasks.filter(t =>
    t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const getByStatus = (s: TaskStatus) => filteredTasks.filter(t => t.status === s);

  return (
    <AppLayout>
      <div className="p-6 lg:p-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Task Board</h1>
            <p className="text-muted-foreground">Manage tasks with Kanban-style organization.</p>
          </div>
          <div className="flex gap-2">
            {/* Export to Jira / Trello / Notion / Linear */}
            <Button variant="outline" onClick={() => setExportOpen(true)}>
              <Share2 className="w-4 h-4 mr-2" />Export Tasks
            </Button>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button disabled={projects.length === 0}>
                  <Plus className="w-4 h-4 mr-2" />New Task
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Task</DialogTitle>
                  <DialogDescription>Add a new task to your project backlog.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Task Title</Label>
                    <Input placeholder="e.g., Implement user authentication" value={newTask.title}
                      onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Project</Label>
                    <Select value={newTask.projectId} onValueChange={(v) => setNewTask({ ...newTask, projectId: v })}>
                      <SelectTrigger><SelectValue placeholder="Select a project" /></SelectTrigger>
                      <SelectContent>
                        {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Priority</Label>
                      <Select value={newTask.priority} onValueChange={(v) => setNewTask({ ...newTask, priority: v as TaskPriority })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="critical">Critical</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Deadline</Label>
                      <Input type="date" value={newTask.deadline}
                        onChange={(e) => setNewTask({ ...newTask, deadline: e.target.value })} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Description (Optional)</Label>
                    <Textarea placeholder="Add details..." value={newTask.description}
                      onChange={(e) => setNewTask({ ...newTask, description: e.target.value })} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                  <Button onClick={handleCreateTask} disabled={creating || !newTask.title.trim() || !newTask.projectId}>
                    {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Create Task
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search tasks..." className="pl-10" value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)} />
        </div>

        {/* Kanban */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto pb-4">
            {statusColumns.map((column) => {
              const columnTasks = getByStatus(column.status);
              return (
                <div key={column.status} className="flex-shrink-0 w-[260px]">
                  <div className={cn("rounded-lg px-3 py-2.5 mb-3 border border-border/50", column.color)}>
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-sm">{column.label}</h3>
                      <Badge className={cn("text-xs font-medium px-2 py-0.5", column.badgeColor)}>
                        {columnTasks.length}
                      </Badge>
                    </div>
                  </div>
                  <div className="space-y-3 min-h-[120px]">
                    {columnTasks.map((task) => (
                      <Card key={task.id} className="card-interactive cursor-pointer"
                        onClick={() => { setSelectedTask(task); setDetailOpen(true); }}>
                        <CardContent className="p-3">
                          <div className="flex items-start justify-between gap-2">
                            <h4 className="font-medium text-sm line-clamp-2">{task.title}</h4>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0"
                                  onClick={(e) => e.stopPropagation()}>
                                  <MoreHorizontal className="w-3.5 h-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => { setSelectedTask(task); setDetailOpen(true); }}>
                                  View Details
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                {statusColumns.filter(c => c.status !== task.status).map(c => (
                                  <DropdownMenuItem key={c.status}
                                    onClick={() => updateTaskStatus(task.id, c.status)}>
                                    Move to {c.label}
                                  </DropdownMenuItem>
                                ))}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => {
                                  setSelectedTaskIds(new Set([task.id]));
                                  setExportOpen(true);
                                }}>
                                  <Share2 className="w-3.5 h-3.5 mr-2" />Export to Jira / Trello
                                </DropdownMenuItem>
                                {task.jira_issue_url && (
                                  <DropdownMenuItem onClick={() => window.open(task.jira_issue_url!, '_blank')}>
                                    <ExternalLink className="w-3.5 h-3.5 mr-2" />Open in Jira ({task.jira_issue_key})
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive"
                                  onClick={() => handleDeleteTask(task.id)}>
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>

                          {task.description && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.description}</p>
                          )}

                          <div className="flex items-center gap-2 mt-3 flex-wrap">
                            <Badge className={cn("text-xs", priorityConfig[task.priority].className)}>
                              {priorityConfig[task.priority].label}
                            </Badge>
                            {task.delay_risk_score && task.delay_risk_score > 0.5 && (
                              <Badge variant="outline" className="text-xs text-warning border-warning/30">
                                <AlertTriangle className="w-3 h-3 mr-1" />
                                {Math.round(task.delay_risk_score * 100)}% risk
                              </Badge>
                            )}
                            {task.jira_issue_key && (
                              <Badge variant="outline" className="text-xs text-blue-400 border-blue-400/30">
                                {task.jira_issue_key}
                              </Badge>
                            )}
                          </div>

                          <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
                            {task.deadline && (
                              <div className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {format(new Date(task.deadline), 'MMM d')}
                              </div>
                            )}
                            <span className="text-xs truncate max-w-[100px]">{task.projects?.name}</span>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                    {columnTasks.length === 0 && (
                      <div className="text-center py-8 text-sm text-muted-foreground">No tasks</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Task Detail Dialog ── */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg">
          {selectedTask && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedTask.title}</DialogTitle>
                <DialogDescription>{selectedTask.projects?.name ?? 'No project'}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                {selectedTask.description && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Description</Label>
                    <p className="text-sm mt-1">{selectedTask.description}</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <div className="mt-1">
                      <Badge className={cn("text-xs", statusColumns.find(c => c.status === selectedTask.status)?.badgeColor)}>
                        {statusColumns.find(c => c.status === selectedTask.status)?.label}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Priority</Label>
                    <div className="mt-1">
                      <Badge className={cn("text-xs", priorityConfig[selectedTask.priority].className)}>
                        {priorityConfig[selectedTask.priority].label}
                      </Badge>
                    </div>
                  </div>
                  {selectedTask.deadline && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Deadline</Label>
                      <p className="text-sm mt-1 flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {format(new Date(selectedTask.deadline), 'MMM d, yyyy')}
                      </p>
                    </div>
                  )}
                  {selectedTask.estimated_hours && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Estimated Hours</Label>
                      <p className="text-sm mt-1">{selectedTask.estimated_hours}h</p>
                    </div>
                  )}
                  {selectedTask.delay_risk_score != null && selectedTask.delay_risk_score > 0 && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Delay Risk</Label>
                      <div className="mt-1">
                        <Badge variant="outline" className="text-xs text-warning border-warning/30">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          {Math.round(selectedTask.delay_risk_score * 100)}%
                        </Badge>
                      </div>
                    </div>
                  )}
                  {selectedTask.jira_issue_key && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Jira Issue</Label>
                      <a href={selectedTask.jira_issue_url ?? '#'} target="_blank" rel="noreferrer"
                        className="text-sm mt-1 flex items-center gap-1 text-blue-400 hover:underline">
                        <ExternalLink className="w-3 h-3" />
                        {selectedTask.jira_issue_key}
                      </a>
                    </div>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Select value={selectedTask.status}
                  onValueChange={(v) => { updateTaskStatus(selectedTask.id, v as TaskStatus); setSelectedTask({ ...selectedTask, status: v as TaskStatus }); }}>
                  <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {statusColumns.map(c => <SelectItem key={c.status} value={c.status}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={() => { setSelectedTaskIds(new Set([selectedTask.id])); setExportOpen(true); }}>
                  <Share2 className="w-4 h-4 mr-2" />Export
                </Button>
                <Button variant="outline" onClick={() => setDetailOpen(false)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Export Dialog ── */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Export Tasks</DialogTitle>
            <DialogDescription>
              Push {selectedTaskIds.size > 0 ? selectedTaskIds.size : filteredTasks.length} task{(selectedTaskIds.size || filteredTasks.length) !== 1 ? 's' : ''} to an external platform.
            </DialogDescription>
          </DialogHeader>

          {/* Platform selector */}
          <div className="grid grid-cols-2 gap-3 mt-2">
            {EXPORT_PLATFORMS.map((p) => {
              const Icon = p.icon;
              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedPlatform(p.id)}
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all",
                    selectedPlatform === p.id ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30"
                  )}
                >
                  <div className={cn("p-2 rounded-lg", p.bg)}>
                    <Icon className={cn("w-5 h-5", p.color)} />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.description}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Platform-specific config */}
          <div className="mt-4 space-y-4">
            {selectedPlatform === 'jira' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Jira Base URL</Label>
                    <Input placeholder="https://yourcompany.atlassian.net"
                      value={exportConfig.jira_base_url}
                      onChange={(e) => setExportConfig({ ...exportConfig, jira_base_url: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label>Project Key</Label>
                    <Input placeholder="e.g. PROJ"
                      value={exportConfig.jira_project_key}
                      onChange={(e) => setExportConfig({ ...exportConfig, jira_project_key: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label>Email</Label>
                    <Input type="email" placeholder="you@company.com"
                      value={exportConfig.jira_email}
                      onChange={(e) => setExportConfig({ ...exportConfig, jira_email: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label>API Token</Label>
                    <Input type="password" placeholder="From id.atlassian.com → API tokens"
                      value={exportConfig.jira_api_token}
                      onChange={(e) => setExportConfig({ ...exportConfig, jira_api_token: e.target.value })} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Get your API token at <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer" className="underline">id.atlassian.com → Security → API tokens</a>
                </p>
              </>
            )}

            {selectedPlatform === 'linear' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Linear API Key</Label>
                    <Input type="password" placeholder="lin_api_..."
                      value={exportConfig.linear_api_key}
                      onChange={(e) => setExportConfig({ ...exportConfig, linear_api_key: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label>Team ID</Label>
                    <Input placeholder="From Linear settings"
                      value={exportConfig.linear_team_id}
                      onChange={(e) => setExportConfig({ ...exportConfig, linear_team_id: e.target.value })} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Get your API key at Linear → Settings → API</p>
              </>
            )}

            {selectedPlatform === 'trello' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>API Key</Label>
                    <Input placeholder="From trello.com/app-key"
                      value={exportConfig.trello_api_key}
                      onChange={(e) => setExportConfig({ ...exportConfig, trello_api_key: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label>Token</Label>
                    <Input type="password" placeholder="From Trello OAuth"
                      value={exportConfig.trello_token}
                      onChange={(e) => setExportConfig({ ...exportConfig, trello_token: e.target.value })} />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <Label>List ID</Label>
                    <Input placeholder="Target list ID (from Trello board URL)"
                      value={exportConfig.trello_list_id}
                      onChange={(e) => setExportConfig({ ...exportConfig, trello_list_id: e.target.value })} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Get credentials at <a href="https://trello.com/app-key" target="_blank" rel="noreferrer" className="underline">trello.com/app-key</a></p>
              </>
            )}

            {selectedPlatform === 'notion' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Integration Token</Label>
                    <Input type="password" placeholder="secret_..."
                      value={exportConfig.notion_token}
                      onChange={(e) => setExportConfig({ ...exportConfig, notion_token: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label>Database ID</Label>
                    <Input placeholder="From your Notion database URL"
                      value={exportConfig.notion_db_id}
                      onChange={(e) => setExportConfig({ ...exportConfig, notion_db_id: e.target.value })} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Create an integration at <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noreferrer" className="underline">notion.so/profile/integrations</a>, then share your database with it.</p>
              </>
            )}
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => { setExportOpen(false); setSelectedTaskIds(new Set()); }}>Cancel</Button>
            <Button onClick={handleExport} disabled={exporting}>
              {exporting
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Exporting...</>
                : <><Share2 className="w-4 h-4 mr-2" />Export to {EXPORT_PLATFORMS.find(p => p.id === selectedPlatform)?.name}</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
