import { useState, useEffect, useRef } from 'react';
import {
  Mail, MessageSquare, Video, FileText, Upload, Plus,
  CheckCircle, AlertCircle, Loader2, Unlink, RefreshCw,
  Database, Wifi, WifiOff, ExternalLink, X, Key
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { IntegrationDataPreview } from './IntegrationDataPreview';

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

interface IntegrationStatus {
  connected: boolean;
  accountEmail?: string | null;
  workspaceName?: string | null;
}

interface DataSourceManagerProps {
  sources: DataSource[];
  onSourcesChange: (sources: DataSource[]) => void;
  onFilterSources: () => void;
  isFiltering?: boolean;
}

const PYTHON_BACKEND = import.meta.env.VITE_PYTHON_BACKEND_URL || 'http://localhost:8000';

const sourceConfig = {
  gmail:    { icon: Mail,          label: 'Gmail',     description: 'Import emails from Gmail',            color: 'text-red-500',    bgColor: 'bg-red-500/10',    borderColor: 'border-red-500/20' },
  slack:    { icon: MessageSquare, label: 'Slack',     description: 'Import messages from Slack channels', color: 'text-purple-500', bgColor: 'bg-purple-500/10', borderColor: 'border-purple-500/20' },
  fireflies:{ icon: Video,         label: 'Fireflies', description: 'Import meeting transcripts',          color: 'text-orange-500', bgColor: 'bg-orange-500/10', borderColor: 'border-orange-500/20' },
  document: { icon: FileText,      label: 'Document',  description: 'Upload PDF, DOCX, or TXT files',      color: 'text-blue-500',   bgColor: 'bg-blue-500/10',   borderColor: 'border-blue-500/20' },
  text:     { icon: FileText,      label: 'Text',      description: 'Paste raw text content',              color: 'text-emerald-500',bgColor: 'bg-emerald-500/10',borderColor: 'border-emerald-500/20' },
};

async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(e.target?.result as string ?? '');
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

async function extractFileContent(file: File): Promise<string> {
  if (file.type === 'text/plain' || file.name.endsWith('.txt')) return readFileAsText(file);
  const ext  = file.name.split('.').pop()?.toLowerCase() ?? 'bin';
  const path = `uploads/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error: uploadError } = await supabase.storage.from('documents').upload(path, file, { contentType: file.type });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
  const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path);
  const { data, error } = await supabase.functions.invoke('extract-document', {
    body: { filePath: path, fileUrl: urlData.publicUrl, fileName: file.name },
  });
  if (error) throw new Error(`Extraction failed: ${error.message}`);
  return data?.text ?? data?.content ?? '';
}

export function DataSourceManager({ sources, onSourcesChange, onFilterSources, isFiltering = false }: DataSourceManagerProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [addDialogOpen, setAddDialogOpen]     = useState(false);
  const [activeTab, setActiveTab]             = useState('text');
  const [textInput, setTextInput]             = useState('');
  const [sourceName, setSourceName]           = useState('');
  const [isAdding, setIsAdding]               = useState(false);
  const [uploadProgress, setUploadProgress]   = useState(0);
  const [uploadedFile, setUploadedFile]       = useState<File | null>(null);
  const [isDragging, setIsDragging]           = useState(false);

  const [integrations, setIntegrations]       = useState<Record<string, IntegrationStatus>>({});
  const [loadingIntegrations, setLoadingIntegrations] = useState(true);
  const [previewProvider, setPreviewProvider] = useState<string | null>(null);
  const [previewData, setPreviewData]         = useState<any[] | null>(null);
  const [fetchingData, setFetchingData]       = useState<string | null>(null);

  // Slack bot token dialog
  const [slackDialogOpen, setSlackDialogOpen] = useState(false);
  const [slackBotToken, setSlackBotToken]     = useState('');
  const [slackConnecting, setSlackConnecting] = useState(false);

  // Fireflies API key dialog
  const [ffDialogOpen, setFfDialogOpen]       = useState(false);
  const [ffApiKey, setFfApiKey]               = useState('');
  const [ffConnecting, setFfConnecting]       = useState(false);

  useEffect(() => {
    async function fetchStatus() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const resp = await fetch(`${PYTHON_BACKEND}/api/integrations/status/${user.id}`);
        if (!resp.ok) throw new Error();
        const data = await resp.json();
        setIntegrations({
          gmail:     { connected: !!data.gmail?.is_active,     accountEmail:  data.gmail?.account_email ?? null },
          slack:     { connected: !!data.slack?.is_active,     workspaceName: data.slack?.metadata?.workspace_name ?? null },
          fireflies: { connected: !!data.fireflies?.is_active },
        });
      } catch {
        setIntegrations({ gmail: { connected: false }, slack: { connected: false }, fireflies: { connected: false } });
      } finally {
        setLoadingIntegrations(false);
      }
    }
    fetchStatus();
  }, []);

  const handleConnectIntegration = async (provider: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if (provider === 'slack')     { setSlackDialogOpen(true); return; }
    if (provider === 'fireflies') { setFfDialogOpen(true); return; }

    // Gmail OAuth
    try {
      const resp = await fetch(`${PYTHON_BACKEND}/api/integrations/${provider}/auth?user_id=${user.id}`);
      if (!resp.ok) throw new Error(`Server ${resp.status}`);
      const data = await resp.json();
      if (data.use_bot_token) { setSlackDialogOpen(true); return; }
      if (data.auth_url) window.location.href = data.auth_url;
      else throw new Error('No auth URL returned');
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    }
  };

  const handleSlackBotConnect = async () => {
    if (!slackBotToken.trim().startsWith('xoxb-')) {
      toast({ variant: 'destructive', title: 'Invalid Token', description: 'Bot token must start with xoxb-' });
      return;
    }
    setSlackConnecting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not logged in');
      const resp = await fetch(`${PYTHON_BACKEND}/api/integrations/slack/connect-bot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, bot_token: slackBotToken.trim(), workspace: 'local' }),
      });
      if (!resp.ok) { const e = await resp.json(); throw new Error(e.detail || `Error ${resp.status}`); }
      const data = await resp.json();
      setIntegrations(prev => ({ ...prev, slack: { connected: true, workspaceName: data.workspace ?? 'local' } }));
      setSlackDialogOpen(false);
      setSlackBotToken('');
      toast({ title: 'Slack Connected!', description: `Found ${data.channels_found} channels. Click Fetch Data.` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Connection Failed', description: e.message });
    } finally {
      setSlackConnecting(false);
    }
  };

  const handleFirefliesConnect = async () => {
    if (!ffApiKey.trim()) {
      toast({ variant: 'destructive', title: 'Missing Key', description: 'Enter your Fireflies API key.' });
      return;
    }
    setFfConnecting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not logged in');

      // Validate first
      const vResp = await fetch(`${PYTHON_BACKEND}/api/integrations/fireflies/validate-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: ffApiKey.trim() }),
      });
      const vData = await vResp.json();
      if (!vData.valid) throw new Error(`Invalid key: ${vData.message}`);

      // Save
      const sResp = await fetch(`${PYTHON_BACKEND}/api/integrations/fireflies/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, api_key: ffApiKey.trim() }),
      });
      if (!sResp.ok) { const e = await sResp.json(); throw new Error(e.detail || `Error ${sResp.status}`); }

      setIntegrations(prev => ({ ...prev, fireflies: { connected: true } }));
      setFfDialogOpen(false);
      setFfApiKey('');
      toast({ title: 'Fireflies Connected!', description: 'API key saved. Click Fetch Data to import transcripts.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Connection Failed', description: e.message });
    } finally {
      setFfConnecting(false);
    }
  };

  const handleFetchIntegrationData = async (provider: string) => {
    setFetchingData(provider);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not logged in');
      const resp = await fetch(`${PYTHON_BACKEND}/api/integrations/${provider}/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, max_results: 20, limit: 30 }),
      });
      if (!resp.ok) { const e = await resp.json(); throw new Error(e.detail || `Fetch failed: ${resp.status}`); }
      const data = await resp.json();
      const items = data.messages ?? data.transcripts ?? [];
      if (items.length === 0) {
        toast({ title: 'No Data', description: `No ${provider} data found.` });
        return;
      }
      setPreviewData(items);
      setPreviewProvider(provider);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Fetch Failed', description: err.message });
    } finally {
      setFetchingData(null);
    }
  };

  const handleAddIntegrationToSources = (data: any[]) => {
    if (!previewProvider) return;
    const config = sourceConfig[previewProvider as keyof typeof sourceConfig];
    const contentItems = data.map((item) => {
      if (previewProvider === 'gmail')
        return `From: ${item.from || ''}\nSubject: ${item.subject || ''}\nDate: ${item.date || ''}\n\n${item.body || item.snippet || ''}`;
      if (previewProvider === 'slack')
        return `[${item.channel || ''}] ${item.user_name || ''}: ${item.text || ''}`;
      if (previewProvider === 'fireflies')
        return `Meeting: ${item.title || ''}\nDate: ${item.date || ''}\n\n${item.overview || ''}\n\n${item.content || ''}`;
      return JSON.stringify(item);
    });
    onSourcesChange([...sources, {
      id: `${previewProvider}-${Date.now()}`,
      type: previewProvider as any,
      name: `${config?.label} — Live (${data.length} items)`,
      status: 'connected',
      content: contentItems.join('\n\n---\n\n'),
      itemCount: data.length,
      lastSync: new Date().toISOString(),
    }]);
    setPreviewProvider(null);
    setPreviewData(null);
    toast({ title: 'Data Added', description: `${data.length} items from ${config?.label} added.` });
  };

  const handleAddTextSource = async () => {
    if (!textInput.trim() || !sourceName.trim()) {
      toast({ variant: 'destructive', title: 'Missing Info', description: 'Provide both a name and content.' });
      return;
    }
    setIsAdding(true);
    onSourcesChange([...sources, {
      id: `text-${Date.now()}`, type: 'text', name: sourceName.trim(),
      status: 'connected', content: textInput.trim(), itemCount: 1,
      lastSync: new Date().toISOString(),
    }]);
    setTextInput(''); setSourceName(''); setAddDialogOpen(false);
    toast({ title: 'Source Added' });
    setIsAdding(false);
  };

  const handleFileSelected = (file: File) => {
    if (file.size > 10 * 1024 * 1024) { toast({ variant: 'destructive', title: 'File Too Large', description: 'Max 10MB.' }); return; }
    setUploadedFile(file);
  };

  const handleUploadConfirm = async () => {
    if (!uploadedFile) return;
    setIsAdding(true); setUploadProgress(10);
    try {
      setUploadProgress(40);
      const text = await extractFileContent(uploadedFile);
      setUploadProgress(80);
      if (!text.trim()) throw new Error('Could not extract text from this file.');
      onSourcesChange([...sources, {
        id: `document-${Date.now()}`, type: 'document', name: uploadedFile.name,
        status: 'connected', content: text, itemCount: 1,
        lastSync: new Date().toISOString(),
        metadata: { fileName: uploadedFile.name, fileSize: uploadedFile.size },
      }]);
      setUploadedFile(null); setUploadProgress(100); setAddDialogOpen(false);
      toast({ title: 'Document Added', description: `"${uploadedFile.name}" extracted.` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Upload Failed', description: err.message });
    } finally {
      setIsAdding(false);
      setTimeout(() => setUploadProgress(0), 1000);
    }
  };

  if (previewData && previewProvider) {
    return (
      <IntegrationDataPreview
        provider={previewProvider}
        data={previewData}
        isMock={false}
        onAddToSources={handleAddIntegrationToSources}
        onClose={() => { setPreviewProvider(null); setPreviewData(null); }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Data Sources</h3>
          <p className="text-sm text-muted-foreground">Add communication data from multiple channels</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onFilterSources} disabled={sources.length === 0 || isFiltering}>
            {isFiltering ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Filter Noise
          </Button>
          <Button onClick={() => setAddDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />Add Source
          </Button>
        </div>
      </div>

      {/* Integration Cards */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {(['gmail', 'slack', 'fireflies'] as const).map((type) => {
          const config      = sourceConfig[type];
          const Icon        = config.icon;
          const integration = integrations[type];
          const isConnected = integration?.connected;
          const isLoading   = loadingIntegrations || fetchingData === type;

          return (
            <Card key={type} className={`border ${config.borderColor} overflow-hidden`}>
              <CardContent className="p-4 flex flex-col gap-3">
                {/* Top row: icon + name + badge — all must fit */}
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`p-2 rounded-lg ${config.bgColor} shrink-0`}>
                    <Icon className={`w-4 h-4 ${config.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold text-sm">{config.label}</span>
                      {isConnected
                        ? <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px] px-1.5 py-0 shrink-0"><Wifi className="w-2.5 h-2.5 mr-1" />Connected</Badge>
                        : <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 border-slate-500/30 text-slate-400"><WifiOff className="w-2.5 h-2.5 mr-1" />Not Connected</Badge>
                      }
                    </div>
                    {/* Subtitle — truncated, never overflows */}
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {isConnected && integration?.accountEmail
                        ? integration.accountEmail
                        : isConnected && integration?.workspaceName
                        ? integration.workspaceName
                        : config.description}
                    </p>
                  </div>
                </div>

                {/* Hint for Fireflies when not connected */}
                {type === 'fireflies' && !isConnected && (
                  <div className="p-2 rounded-lg bg-orange-500/10 border border-orange-500/20 text-[11px] text-orange-400 flex items-center gap-1.5">
                    <Video className="w-3 h-3 shrink-0" />
                    <span className="truncate">Upload transcripts or paste text</span>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-2 mt-auto">
                  {isConnected ? (
                    <Button variant="outline" size="sm" className="flex-1 h-8 text-xs"
                      onClick={() => handleFetchIntegrationData(type)} disabled={isLoading}>
                      {isLoading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Database className="w-3.5 h-3.5 mr-1" />}
                      Fetch Data
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" className="flex-1 h-8 text-xs"
                      onClick={() => handleConnectIntegration(type)} disabled={isLoading}>
                      <ExternalLink className="w-3.5 h-3.5 mr-1" />Connect
                    </Button>
                  )}
                  {isConnected && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Connected</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {/* Upload/Paste card */}
        <Card className="cursor-pointer border-dashed hover:shadow-md transition-all" onClick={() => setAddDialogOpen(true)}>
          <CardContent className="p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <div className="p-2 rounded-lg bg-muted shrink-0">
                <Upload className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <span className="font-semibold text-sm">Upload / Paste</span>
                <p className="text-xs text-muted-foreground truncate">PDF, DOCX, TXT or paste text</p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="h-8 text-xs w-full">
              <Plus className="w-3.5 h-3.5 mr-1" />Add Content
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Connected sources list */}
      {sources.filter(s => s.status === 'connected').length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm">Added Sources ({sources.filter(s => s.status === 'connected').length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pb-4">
            {sources.filter(s => s.status === 'connected').map((source) => {
              const config = sourceConfig[source.type];
              const Icon   = config.icon;
              return (
                <div key={source.id} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/50 border">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className={`p-1.5 rounded shrink-0 ${config.bgColor}`}>
                      <Icon className={`w-3.5 h-3.5 ${config.color}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-xs truncate">{source.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{source.itemCount} items</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0"
                    onClick={() => onSourcesChange(sources.filter(s => s.id !== source.id))}>
                    <Unlink className="w-3.5 h-3.5" />
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ── Slack Dialog ── */}
      <Dialog open={slackDialogOpen} onOpenChange={setSlackDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-purple-500" />Connect Slack
            </DialogTitle>
            <DialogDescription>Slack OAuth requires HTTPS. Use a bot token for local dev.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20 text-xs text-purple-300 space-y-2">
              <p className="font-medium">How to get your bot token:</p>
              <ol className="list-decimal list-inside space-y-1 text-purple-400">
                <li>Go to <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer" className="underline">api.slack.com/apps</a> → Create New App</li>
                <li>OAuth & Permissions → Bot Token Scopes → add: <code className="bg-black/30 px-1 rounded">channels:history channels:read users:read</code></li>
                <li>Install to Workspace → copy the <code className="bg-black/30 px-1 rounded">xoxb-...</code> token</li>
              </ol>
            </div>
            <div className="space-y-1.5">
              <Label>Bot User OAuth Token</Label>
              <Input placeholder="xoxb-..." value={slackBotToken} onChange={e => setSlackBotToken(e.target.value)} className="font-mono text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSlackDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSlackBotConnect} disabled={slackConnecting || !slackBotToken.trim()} className="bg-purple-600 hover:bg-purple-700">
              {slackConnecting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Connect Slack
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Fireflies Dialog ── */}
      <Dialog open={ffDialogOpen} onOpenChange={setFfDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Video className="w-5 h-5 text-orange-500" />Connect Fireflies.ai
            </DialogTitle>
            <DialogDescription>Enter your Fireflies API key to import meeting transcripts.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/20 text-xs text-orange-300 space-y-1">
              <p className="font-medium">Get your API key:</p>
              <p>Go to <a href="https://app.fireflies.ai/integrations/custom/fireflies" target="_blank" rel="noreferrer" className="underline">app.fireflies.ai → Integrations → API</a> and copy your key.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Fireflies API Key</Label>
              <Input placeholder="your-api-key..." value={ffApiKey} onChange={e => setFfApiKey(e.target.value)} className="font-mono text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFfDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleFirefliesConnect} disabled={ffConnecting || !ffApiKey.trim()} className="bg-orange-600 hover:bg-orange-700">
              {ffConnecting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Connect Fireflies
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add Source Dialog ── */}
      <Dialog open={addDialogOpen} onOpenChange={(o) => { setAddDialogOpen(o); if (!o) { setUploadedFile(null); setUploadProgress(0); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Data Source</DialogTitle>
            <DialogDescription>Add communication data for requirements extraction.</DialogDescription>
          </DialogHeader>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid grid-cols-2">
              <TabsTrigger value="text">Paste Text</TabsTrigger>
              <TabsTrigger value="document">Upload Document</TabsTrigger>
            </TabsList>
            <TabsContent value="text" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Source Name</Label>
                <Input placeholder="e.g., Kickoff Meeting Notes" value={sourceName} onChange={e => setSourceName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Content</Label>
                <Textarea placeholder="Paste emails, meeting transcripts, Slack messages..."
                  className="min-h-[200px] font-mono text-sm" value={textInput} onChange={e => setTextInput(e.target.value)} />
              </div>
            </TabsContent>
            <TabsContent value="document" className="space-y-4 mt-4">
              {!uploadedFile ? (
                <div className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'}`}
                  onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFileSelected(f); }}>
                  <Upload className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                  <p className="font-medium mb-1">Drop files here or click to upload</p>
                  <p className="text-sm text-muted-foreground mb-4">PDF, DOCX, TXT up to 10MB</p>
                  <Button variant="outline" onClick={() => fileInputRef.current?.click()}>Browse Files</Button>
                  <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelected(f); }} />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-muted border">
                    <FileText className="w-6 h-6 text-blue-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{uploadedFile.name}</p>
                      <p className="text-xs text-muted-foreground">{(uploadedFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setUploadedFile(null)}><X className="w-4 h-4" /></Button>
                  </div>
                  {uploadProgress > 0 && uploadProgress < 100 && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Extracting... {uploadProgress}%</p>
                      <Progress value={uploadProgress} className="h-1.5" />
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>Cancel</Button>
            {activeTab === 'text'
              ? <Button onClick={handleAddTextSource} disabled={isAdding || !textInput.trim() || !sourceName.trim()}>
                  {isAdding && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Add Source
                </Button>
              : <Button onClick={handleUploadConfirm} disabled={isAdding || !uploadedFile}>
                  {isAdding && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {uploadedFile ? 'Extract & Add' : 'Select a file first'}
                </Button>
            }
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
