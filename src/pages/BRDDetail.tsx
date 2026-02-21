import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { 
  FileText, 
  ArrowLeft, 
  Sparkles,
  CheckCircle,
  AlertCircle,
  Clock,
  Archive,
  ChevronDown,
  ChevronRight,
  Quote,
  Target,
  Users,
  ListChecks,
  Shield,
  Lightbulb,
  BarChart3,
  Calendar,
  Loader2,
  Wand2,
  FileUp,
  Play,
  Edit3,
  Save,
  GitBranch,
  Brain
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
import { formatDistanceToNow } from 'date-fns';
import { NaturalLanguageEditor } from '@/components/brd/NaturalLanguageEditor';
import { ConflictDetectionPanel } from '@/components/brd/ConflictDetectionPanel';
import { SentimentAnalysisPanel } from '@/components/brd/SentimentAnalysisPanel';
import { TraceabilityMatrix } from '@/components/brd/TraceabilityMatrix';

interface Requirement {
  id: string;
  title?: string;
  description: string;
  priority?: string;
  source?: string;
  category?: string;
}

interface Stakeholder {
  id: string;
  name: string;
  interest: string;
  influence: string;
}

interface Objective {
  id: string;
  description: string;
  priority: string;
  source?: string;
}

interface Assumption {
  id: string;
  description: string;
  risk: string;
}

interface Metric {
  id: string;
  metric: string;
  target: string;
  measurement: string;
}

interface TimelinePhase {
  name: string;
  duration: string;
  deliverables: string[];
}

interface BRDData {
  id: string;
  title: string;
  version: number;
  status: 'draft' | 'in_review' | 'approved' | 'archived';
  executive_summary: string | null;
  business_objectives: Objective[];
  stakeholder_analysis: Stakeholder[];
  functional_requirements: Requirement[];
  non_functional_requirements: Requirement[];
  assumptions: Assumption[];
  success_metrics: Metric[];
  timeline: { phases?: TimelinePhase[] };
  project_id: string;
  created_at: string;
  updated_at: string;
  raw_sources: any[];
  projects?: { name: string };
}

const statusConfig = {
  draft: { label: 'Draft', icon: Clock, className: 'status-draft' },
  in_review: { label: 'In Review', icon: AlertCircle, className: 'status-in_review' },
  approved: { label: 'Approved', icon: CheckCircle, className: 'status-approved' },
  archived: { label: 'Archived', icon: Archive, className: 'status-archived' },
};

const priorityColors: Record<string, string> = {
  high: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  low: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
};

export default function BRDDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [brd, setBrd] = useState<BRDData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatingTasks, setGeneratingTasks] = useState(false);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    summary: true,
    objectives: true,
    stakeholders: false,
    functional: true,
    nonfunctional: false,
    assumptions: false,
    metrics: false,
    timeline: false,
  });
  const [activeTab, setActiveTab] = useState('document');

  const fetchBRD = useCallback(async () => {
    if (!id) return;
    
    try {
      const { data, error } = await supabase
        .from('brds')
        .select('*, projects(name)')
        .eq('id', id)
        .single();

      if (error) throw error;
      
      // Parse JSON fields with safety - cast via unknown
      const parseAssumptions = (raw: any): Assumption[] => {
        if (!Array.isArray(raw)) return [];
        return raw.map((item: any, i: number) => {
          if (typeof item === 'string') {
            return { id: `A-${i + 1}`, description: item, risk: 'To be assessed' };
          }
          return item as Assumption;
        });
      };

      setBrd({
        ...data,
        business_objectives: (Array.isArray(data.business_objectives) ? data.business_objectives : []) as unknown as Objective[],
        stakeholder_analysis: (Array.isArray(data.stakeholder_analysis) ? data.stakeholder_analysis : []) as unknown as Stakeholder[],
        functional_requirements: (Array.isArray(data.functional_requirements) ? data.functional_requirements : []) as unknown as Requirement[],
        non_functional_requirements: (Array.isArray(data.non_functional_requirements) ? data.non_functional_requirements : []) as unknown as Requirement[],
        assumptions: parseAssumptions(data.assumptions),
        success_metrics: (Array.isArray(data.success_metrics) ? data.success_metrics : []) as unknown as Metric[],
        timeline: (data.timeline && typeof data.timeline === 'object' && !Array.isArray(data.timeline) ? data.timeline : { phases: [] }) as unknown as { phases?: TimelinePhase[] },
        raw_sources: (Array.isArray(data.raw_sources) ? data.raw_sources : []) as unknown as any[],
      });
    } catch (error) {
      console.error('Error fetching BRD:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load BRD',
      });
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    fetchBRD();
  }, [fetchBRD]);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handleStatusChange = async (newStatus: 'draft' | 'in_review' | 'approved' | 'archived') => {
    if (!brd) return;

    try {
      const { error } = await supabase
        .from('brds')
        .update({ status: newStatus })
        .eq('id', brd.id);

      if (error) throw error;

      setBrd({ ...brd, status: newStatus });
      toast({
        title: 'Status Updated',
        description: `BRD status changed to ${statusConfig[newStatus].label}`,
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message,
      });
    }
  };

  const handleRegenerateSection = async (section: string) => {
    if (!brd) return;

    setGenerating(true);
    try {
      const rawText = brd.raw_sources?.[0]?.content || '';
      
      const { error } = await supabase.functions.invoke('process-brd', {
        body: { brdId: brd.id, rawText },
      });

      if (error) throw error;

      toast({
        title: 'Regenerating',
        description: 'AI is reprocessing your BRD. Please wait...',
      });

      // Refetch after a delay
      setTimeout(fetchBRD, 3000);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message,
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateTasks = async () => {
    if (!brd || !user) return;

    if (brd.status !== 'approved') {
      toast({
        variant: 'destructive',
        title: 'BRD Not Approved',
        description: 'Please approve the BRD before generating tasks.',
      });
      return;
    }

    setGeneratingTasks(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-tasks', {
        body: { 
          brdId: brd.id, 
          projectId: brd.project_id,
          userId: user.id,
        },
      });

      if (error) throw error;

      toast({
        title: 'Tasks Generated',
        description: `Created ${data.tasks?.length || 0} tasks from BRD requirements.`,
      });

      navigate('/tasks');
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message,
      });
    } finally {
      setGeneratingTasks(false);
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (!brd) {
    return (
      <AppLayout>
        <div className="p-6 text-center">
          <h2 className="text-xl font-semibold mb-2">BRD Not Found</h2>
          <Button asChild>
            <Link to="/brd">Back to BRDs</Link>
          </Button>
        </div>
      </AppLayout>
    );
  }

  const status = statusConfig[brd.status];
  const StatusIcon = status.icon;
  const completeness = calculateCompleteness(brd);

  return (
    <AppLayout>
      <div className="p-6 lg:p-8 space-y-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link to="/brd">
                <ArrowLeft className="w-5 h-5" />
              </Link>
            </Button>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-2xl font-bold tracking-tight">{brd.title}</h1>
                <Badge className={status.className}>
                  <StatusIcon className="w-3 h-3 mr-1" />
                  {status.label}
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span>{brd.projects?.name}</span>
                <span>•</span>
                <span>Version {brd.version}</span>
                <span>•</span>
                <span>Updated {formatDistanceToNow(new Date(brd.updated_at), { addSuffix: true })}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={brd.status} onValueChange={handleStatusChange}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="in_review">In Review</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
            <Button 
              onClick={handleGenerateTasks}
              disabled={generatingTasks || brd.status !== 'approved'}
            >
              {generatingTasks ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              Generate Tasks
            </Button>
          </div>
        </div>

        {/* Completeness Progress */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Document Completeness</span>
              <span className="text-sm text-muted-foreground">{completeness}%</span>
            </div>
            <Progress value={completeness} className="h-2" />
          </CardContent>
        </Card>

        {/* Natural Language Editor */}
        <NaturalLanguageEditor brdId={brd.id} onEditComplete={fetchBRD} />

        {/* Tabs for Document / Analysis / Traceability */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-3 w-full max-w-lg">
            <TabsTrigger value="document">
              <FileText className="w-4 h-4 mr-2" />
              Document
            </TabsTrigger>
            <TabsTrigger value="analysis">
              <Brain className="w-4 h-4 mr-2" />
              Analysis
            </TabsTrigger>
            <TabsTrigger value="traceability">
              <GitBranch className="w-4 h-4 mr-2" />
              Traceability
            </TabsTrigger>
          </TabsList>

          <TabsContent value="document" className="space-y-6 mt-6">

        {/* Executive Summary */}
        <BRDSection
          title="Executive Summary"
          icon={FileText}
          isExpanded={expandedSections.summary}
          onToggle={() => toggleSection('summary')}
          onRegenerate={() => handleRegenerateSection('summary')}
          generating={generating}
        >
          <p className="text-muted-foreground leading-relaxed">
            {brd.executive_summary || 'No executive summary available. Add source content to generate.'}
          </p>
        </BRDSection>

        {/* Business Objectives */}
        <BRDSection
          title="Business Objectives"
          icon={Target}
          isExpanded={expandedSections.objectives}
          onToggle={() => toggleSection('objectives')}
          count={brd.business_objectives.length}
        >
          {brd.business_objectives.length === 0 ? (
            <p className="text-muted-foreground">No business objectives extracted yet.</p>
          ) : (
            <div className="space-y-3">
              {brd.business_objectives.map((obj, index) => (
                <div key={obj.id || index} className="p-3 rounded-lg bg-muted/50 border">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline">{obj.id}</Badge>
                        {obj.priority && (
                          <Badge className={priorityColors[obj.priority] || 'bg-muted'}>
                            {obj.priority}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm">{obj.description}</p>
                      {obj.source && (
                        <div className="flex items-start gap-2 mt-2 text-xs text-muted-foreground">
                          <Quote className="w-3 h-3 mt-0.5 flex-shrink-0" />
                          <span className="italic">"{obj.source}"</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </BRDSection>

        {/* Stakeholder Analysis */}
        <BRDSection
          title="Stakeholder Analysis"
          icon={Users}
          isExpanded={expandedSections.stakeholders}
          onToggle={() => toggleSection('stakeholders')}
          count={brd.stakeholder_analysis.length}
        >
          {brd.stakeholder_analysis.length === 0 ? (
            <p className="text-muted-foreground">No stakeholders identified yet.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {brd.stakeholder_analysis.map((sh, index) => (
                <div key={sh.id || index} className="p-3 rounded-lg bg-muted/50 border">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline">{sh.id}</Badge>
                    <span className="font-medium">{sh.name}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">{sh.interest}</p>
                  <Badge className={
                    sh.influence === 'high' ? 'bg-red-100 text-red-700 dark:bg-red-900/30' :
                    sh.influence === 'medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30' :
                    'bg-green-100 text-green-700 dark:bg-green-900/30'
                  }>
                    {sh.influence} influence
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </BRDSection>

        {/* Functional Requirements */}
        <BRDSection
          title="Functional Requirements"
          icon={ListChecks}
          isExpanded={expandedSections.functional}
          onToggle={() => toggleSection('functional')}
          count={brd.functional_requirements.length}
        >
          {brd.functional_requirements.length === 0 ? (
            <p className="text-muted-foreground">No functional requirements extracted yet.</p>
          ) : (
            <div className="space-y-3">
              {brd.functional_requirements.map((req, index) => (
                <RequirementCard key={req.id || index} requirement={req} />
              ))}
            </div>
          )}
        </BRDSection>

        {/* Non-Functional Requirements */}
        <BRDSection
          title="Non-Functional Requirements"
          icon={Shield}
          isExpanded={expandedSections.nonfunctional}
          onToggle={() => toggleSection('nonfunctional')}
          count={brd.non_functional_requirements.length}
        >
          {brd.non_functional_requirements.length === 0 ? (
            <p className="text-muted-foreground">No non-functional requirements extracted yet.</p>
          ) : (
            <div className="space-y-3">
              {brd.non_functional_requirements.map((req, index) => (
                <RequirementCard key={req.id || index} requirement={req} />
              ))}
            </div>
          )}
        </BRDSection>

        {/* Assumptions */}
        <BRDSection
          title="Assumptions & Risks"
          icon={Lightbulb}
          isExpanded={expandedSections.assumptions}
          onToggle={() => toggleSection('assumptions')}
          count={brd.assumptions.length}
        >
          {brd.assumptions.length === 0 ? (
            <p className="text-muted-foreground">No assumptions identified yet.</p>
          ) : (
            <div className="space-y-3">
              {brd.assumptions.map((a, index) => (
                <div key={a.id || index} className="p-3 rounded-lg bg-muted/50 border">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline">{a.id}</Badge>
                  </div>
                  <p className="text-sm mb-2">{a.description}</p>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium">Risk if wrong:</span> {a.risk}
                  </div>
                </div>
              ))}
            </div>
          )}
        </BRDSection>

        {/* Success Metrics */}
        <BRDSection
          title="Success Metrics"
          icon={BarChart3}
          isExpanded={expandedSections.metrics}
          onToggle={() => toggleSection('metrics')}
          count={brd.success_metrics.length}
        >
          {brd.success_metrics.length === 0 ? (
            <p className="text-muted-foreground">No success metrics defined yet.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {brd.success_metrics.map((m, index) => (
                <div key={m.id || index} className="p-3 rounded-lg bg-muted/50 border">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline">{m.id}</Badge>
                    <span className="font-medium">{m.metric}</span>
                  </div>
                  <div className="text-sm space-y-1">
                    <p><span className="text-muted-foreground">Target:</span> {m.target}</p>
                    <p><span className="text-muted-foreground">Measured by:</span> {m.measurement}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </BRDSection>

        {/* Timeline */}
        <BRDSection
          title="Timeline & Phases"
          icon={Calendar}
          isExpanded={expandedSections.timeline}
          onToggle={() => toggleSection('timeline')}
          count={brd.timeline?.phases?.length || 0}
        >
          {!brd.timeline?.phases?.length ? (
            <p className="text-muted-foreground">No timeline defined yet.</p>
          ) : (
            <div className="space-y-3">
              {brd.timeline.phases.map((phase, index) => (
                <div key={index} className="p-3 rounded-lg bg-muted/50 border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">{phase.name}</span>
                    <Badge variant="outline">{phase.duration}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {phase.deliverables?.map((d, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {d}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </BRDSection>

          </TabsContent>

          {/* Analysis Tab */}
          <TabsContent value="analysis" className="space-y-6 mt-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <ConflictDetectionPanel brdId={brd.id} />
              <SentimentAnalysisPanel brdId={brd.id} />
            </div>
          </TabsContent>

          {/* Traceability Tab */}
          <TabsContent value="traceability" className="mt-6">
            <TraceabilityMatrix brdId={brd.id} projectId={brd.project_id} />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

// Helper Components
function BRDSection({ 
  title, 
  icon: Icon, 
  isExpanded, 
  onToggle, 
  onRegenerate,
  generating,
  count,
  children 
}: {
  title: string;
  icon: any;
  isExpanded: boolean;
  onToggle: () => void;
  onRegenerate?: () => void;
  generating?: boolean;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <CardTitle className="text-lg">{title}</CardTitle>
                {count !== undefined && count > 0 && (
                  <Badge variant="secondary">{count}</Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {onRegenerate && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRegenerate();
                    }}
                    disabled={generating}
                  >
                    {generating ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Wand2 className="w-4 h-4" />
                    )}
                  </Button>
                )}
                {isExpanded ? (
                  <ChevronDown className="w-5 h-5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-muted-foreground" />
                )}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            {children}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function RequirementCard({ requirement }: { requirement: Requirement }) {
  return (
    <div className="p-3 rounded-lg bg-muted/50 border">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge variant="outline">{requirement.id}</Badge>
            {requirement.title && (
              <span className="font-medium">{requirement.title}</span>
            )}
            {requirement.priority && (
              <Badge className={priorityColors[requirement.priority] || 'bg-muted'}>
                {requirement.priority}
              </Badge>
            )}
            {requirement.category && (
              <Badge variant="secondary">{requirement.category}</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{requirement.description}</p>
          {requirement.source && (
            <div className="flex items-start gap-2 mt-2 text-xs text-muted-foreground">
              <Quote className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span className="italic">"{requirement.source}"</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function calculateCompleteness(brd: BRDData): number {
  let score = 0;
  const total = 8;

  if (brd.executive_summary) score++;
  if (brd.business_objectives.length > 0) score++;
  if (brd.stakeholder_analysis.length > 0) score++;
  if (brd.functional_requirements.length > 0) score++;
  if (brd.non_functional_requirements.length > 0) score++;
  if (brd.assumptions.length > 0) score++;
  if (brd.success_metrics.length > 0) score++;
  if (brd.timeline?.phases?.length) score++;

  return Math.round((score / total) * 100);
}
