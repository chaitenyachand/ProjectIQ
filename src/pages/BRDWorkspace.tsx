import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  FileText, Upload, Plus, Sparkles, Clock,
  CheckCircle, AlertCircle, Archive, Search, Loader2, RefreshCw
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { DataSourceManager } from '@/components/brd/DataSourceManager';

const PYTHON_BACKEND = import.meta.env.VITE_PYTHON_BACKEND_URL || 'http://localhost:8000';

interface DataSource {
  id: string;
  type: 'gmail' | 'slack' | 'fireflies' | 'document' | 'text';
  name: string;
  status: 'connected' | 'disconnected' | 'syncing';
  lastSync?: string;
  itemCount?: number;
  content?: string;
  metadata?: Record<string, any>;
}

interface BRD {
  id: string;
  title: string;
  version: number;
  status: 'draft' | 'in_review' | 'approved' | 'archived';
  executive_summary: string | null;
  project_id: string;
  created_at: string;
  updated_at: string;
  projects?: { name: string };
}

interface Project { id: string; name: string; }

const statusConfig = {
  draft:     { label: 'Draft',     icon: Clock,         className: 'status-draft' },
  in_review: { label: 'In Review', icon: AlertCircle,   className: 'status-in_review' },
  approved:  { label: 'Approved',  icon: CheckCircle,   className: 'status-approved' },
  archived:  { label: 'Archived',  icon: Archive,       className: 'status-archived' },
};

// ── Agent polling helper ──────────────────────────────────────────────────────
async function pollAgentStatus(
  runId: string,
  onProgress: (pct: number) => void,
  maxAttempts = 60,
): Promise<{ success: boolean; error?: string }> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const resp = await fetch(`${PYTHON_BACKEND}/api/agent/status/${runId}`);
      const data = await resp.json();
      onProgress(Math.min(90, 20 + i * 2));

      if (data.status === 'done')   return { success: true };
      if (data.status === 'failed') return { success: false, error: data.output?.error ?? 'Agent failed' };
    } catch {
      // Network hiccup — keep polling
    }
  }
  return { success: false, error: 'Timed out waiting for BRD generation.' };
}

export default function BRDWorkspace() {
  const { user }  = useAuth();
  const { toast } = useToast();
  const [brds, setBrds]             = useState<BRD[]>([]);
  const [projects, setProjects]     = useState<Project[]>([]);
  const [loading, setLoading]       = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating]     = useState(false);
  const [progress, setProgress]     = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [newBRD, setNewBRD]         = useState({ title: '', projectId: '', rawText: '' });
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [isFiltering, setIsFiltering] = useState(false);
  const abortRef = useRef(false);

  useEffect(() => { fetchData(); }, [user]);

  async function fetchData() {
    if (!user) return;
    try {
      const [brdsRes, projRes] = await Promise.all([
        supabase.from('brds').select('*, projects(name)').order('updated_at', { ascending: false }),
        supabase.from('projects').select('id, name').order('name'),
      ]);
      if (brdsRes.error) throw brdsRes.error;
      if (projRes.error) throw projRes.error;
      setBrds(brdsRes.data ?? []);
      setProjects(projRes.data ?? []);
    } catch (e) {
      console.error('fetchData:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleFilterSources() {
    if (dataSources.length === 0) return;
    setIsFiltering(true);
    try {
      const sources = dataSources.map(s => ({ type: s.type, content: s.content, name: s.name, metadata: s.metadata }));
      const resp = await fetch(`${PYTHON_BACKEND}/api/ml/filter-sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources, threshold: 0.3 }),
      });
      const data = await resp.json();
      toast({
        title: 'Noise Filtering Complete',
        description: `${data.total_relevant ?? 0} of ${data.total_input ?? 0} sources are relevant. ${data.noise_removed ?? 0} noise items removed.`,
      });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Filtering Failed', description: e.message });
    } finally {
      setIsFiltering(false);
    }
  }

  async function handleCreateBRD() {
    if (!user || !newBRD.title.trim() || !newBRD.projectId) return;

    // Build structured sources array — this is what the Python agent expects
    const sources: any[] = [
      ...dataSources.filter(s => s.content).map(s => ({
        type:     s.type === 'text' ? 'document' : s.type,
        content:  s.content,
        name:     s.name,
        metadata: s.metadata ?? {},
      })),
      ...(newBRD.rawText.trim() ? [{
        type:     'document',
        content:  newBRD.rawText.trim(),
        name:     'Additional Notes',
        metadata: {},
      }] : []),
    ];

    const hasContent = sources.length > 0;

    setCreating(true);
    abortRef.current = false;
    setProgress(5);
    setProgressLabel('Creating BRD record...');

    try {
      // 1. Insert BRD row
      const { data: brd, error } = await supabase
        .from('brds')
        .insert({
          title:       newBRD.title.trim(),
          project_id:  newBRD.projectId,
          created_by:  user.id,
          raw_sources: sources,
        })
        .select()
        .single();

      if (error) throw error;

      if (!hasContent) {
        toast({ title: 'BRD Created', description: 'Add content to generate requirements.' });
        closeDialog();
        fetchData();
        return;
      }

      setProgress(15);
      setProgressLabel('Sending to AI agent...');

      toast({
        title: 'Generating BRD',
        description: 'AI is extracting requirements from your sources. This takes 30–90 seconds...',
      });

      // 2. Call Python agent — returns run_id immediately
      const agentResp = await fetch(`${PYTHON_BACKEND}/api/agent/generate-brd`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brd_id:          brd.id,
          project_id:      newBRD.projectId,
          sources:         sources,
          project_context: newBRD.title,
        }),
      });

      if (!agentResp.ok) throw new Error(`Agent error: ${agentResp.status}`);
      const { run_id } = await agentResp.json();

      setProgress(20);
      setProgressLabel('Agent is working — filtering noise, extracting requirements...');

      // 3. Poll until done
      const result = await pollAgentStatus(run_id, setProgress);

      if (abortRef.current) return;

      if (result.success) {
        setProgress(100);
        setProgressLabel('Done!');
        toast({ title: '✅ BRD Generated', description: 'Requirements extracted successfully. Opening your BRD...' });
        closeDialog();
        fetchData();
      } else {
        throw new Error(result.error ?? 'Generation failed');
      }
    } catch (e: any) {
      if (abortRef.current) return;
      toast({ variant: 'destructive', title: 'Error', description: e.message ?? 'Failed to create BRD' });
    } finally {
      setCreating(false);
      setProgress(0);
      setProgressLabel('');
    }
  }

  function closeDialog() {
    abortRef.current = true;
    setDialogOpen(false);
    setNewBRD({ title: '', projectId: '', rawText: '' });
    setDataSources([]);
    setProgress(0);
  }

  const filteredBRDs = brds.filter(
    (b) =>
      b.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.projects?.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <AppLayout>
      <div className="p-6 lg:p-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">BRD Workspace</h1>
            <p className="text-muted-foreground">Generate and manage Business Requirements Documents with AI.</p>
          </div>
          <div className="flex gap-2">
            <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) closeDialog(); else setDialogOpen(true); }}>
              <DialogTrigger asChild>
                <Button><Sparkles className="w-4 h-4 mr-2" />New BRD</Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create New BRD</DialogTitle>
                  <DialogDescription>
                    Connect data sources or upload documents — our AI will extract and structure requirements automatically.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="title">BRD Title</Label>
                      <Input
                        id="title"
                        placeholder="e.g., E-Commerce Platform Requirements"
                        value={newBRD.title}
                        onChange={(e) => setNewBRD({ ...newBRD, title: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="project">Project</Label>
                      <Select value={newBRD.projectId} onValueChange={(v) => setNewBRD({ ...newBRD, projectId: v })}>
                        <SelectTrigger><SelectValue placeholder="Select a project" /></SelectTrigger>
                        <SelectContent>
                          {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <DataSourceManager
                    sources={dataSources}
                    onSourcesChange={setDataSources}
                    onFilterSources={handleFilterSources}
                    isFiltering={isFiltering}
                  />

                  <div className="space-y-2">
                    <Label htmlFor="rawText">
                      Additional Notes (Optional)
                      <span className="text-muted-foreground font-normal ml-2">Paste extra requirements or context</span>
                    </Label>
                    <Textarea
                      id="rawText"
                      placeholder="Paste additional requirements, meeting transcripts, or any text..."
                      className="min-h-[100px] font-mono text-sm"
                      value={newBRD.rawText}
                      onChange={(e) => setNewBRD({ ...newBRD, rawText: e.target.value })}
                    />
                  </div>

                  {/* Generation progress */}
                  {creating && (
                    <div className="space-y-2 p-4 rounded-lg bg-primary/5 border border-primary/10">
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-primary" />
                        <p className="text-sm font-medium">{progressLabel}</p>
                      </div>
                      <Progress value={progress} className="h-2" />
                      <p className="text-xs text-muted-foreground">
                        The agent is: filtering noise → extracting requirements → detecting conflicts → analysing sentiment
                      </p>
                    </div>
                  )}

                  {!creating && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/10">
                      <Sparkles className="w-4 h-4 text-primary" />
                      <p className="text-sm text-muted-foreground">
                        AI will filter noise, extract requirements, detect conflicts, and structure your document with source citations.
                      </p>
                    </div>
                  )}
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={closeDialog} disabled={creating}>Cancel</Button>
                  <Button
                    onClick={handleCreateBRD}
                    disabled={creating || !newBRD.title.trim() || !newBRD.projectId}
                  >
                    {creating
                      ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating...</>
                      : (dataSources.length > 0 || newBRD.rawText) ? 'Generate BRD' : 'Create Empty BRD'
                    }
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search BRDs..."
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* BRDs List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : filteredBRDs.length === 0 ? (
          <Card className="flex flex-col items-center justify-center py-12">
            <FileText className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">{searchQuery ? 'No BRDs found' : 'No BRDs yet'}</h3>
            <p className="text-muted-foreground text-center max-w-sm mb-4">
              {searchQuery ? 'Try a different search term'
                : projects.length === 0 ? 'Create a project first, then generate your first BRD.'
                : 'Generate your first Business Requirements Document with AI assistance.'}
            </p>
            {!searchQuery && projects.length > 0 && (
              <Button onClick={() => setDialogOpen(true)}><Sparkles className="w-4 h-4 mr-2" />Create BRD</Button>
            )}
            {!searchQuery && projects.length === 0 && (
              <Button asChild><Link to="/projects"><Plus className="w-4 h-4 mr-2" />Create Project First</Link></Button>
            )}
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredBRDs.map((brd) => {
              const status = statusConfig[brd.status];
              const StatusIcon = status.icon;
              const isEmpty = !brd.executive_summary;
              return (
                <Card key={brd.id} className="card-interactive">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      <div className="p-2.5 rounded-lg bg-primary/10">
                        <FileText className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <Link to={`/brd/${brd.id}`} className="text-lg font-medium hover:text-primary transition-colors">
                              {brd.title}
                            </Link>
                            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                              <span>{brd.projects?.name}</span>
                              <span>•</span>
                              <span>Version {brd.version}</span>
                              <span>•</span>
                              <span>Updated {formatDistanceToNow(new Date(brd.updated_at), { addSuffix: true })}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {isEmpty && (
                              <Badge variant="outline" className="text-xs text-amber-400 border-amber-400/30">Empty</Badge>
                            )}
                            <Badge className={status.className}>
                              <StatusIcon className="w-3 h-3 mr-1" />{status.label}
                            </Badge>
                          </div>
                        </div>
                        {brd.executive_summary && (
                          <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{brd.executive_summary}</p>
                        )}
                        {isEmpty && (
                          <p className="text-sm text-amber-400/80 mt-2">
                            No requirements extracted yet. Open the BRD and click "Regenerate" to process your sources.
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
