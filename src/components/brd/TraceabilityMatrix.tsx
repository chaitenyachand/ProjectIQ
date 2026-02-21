/**
 * components/brd/TraceabilityMatrix.tsx
 *
 * Mentor suggestions #5:
 *  a) Unique identifier for each data source (SRC-1, SRC-2 etc.) so you
 *     can tell exactly which source a requirement came from
 *  b) Replace the white/light gradient flow bar with a dark themed version
 *     that matches the rest of the dark UI
 */

import { useState, useEffect } from 'react';
import {
  GitBranch, Loader2, RefreshCw, FileText, Target,
  ListChecks, CheckSquare, ChevronRight, Link as LinkIcon,
  Mail, MessageSquare, Video, Upload, FileUp
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface TraceabilityLink {
  source: { id: string; type: string; name: string; excerpt?: string };
  target: { id: string; type: string; name: string };
}

interface TraceabilityMatrixProps {
  brdId: string;
  projectId: string;
}

// ── Source type → icon + color ─────────────────────────────────────────────
const SOURCE_TYPE_CONFIG: Record<string, { icon: any; color: string; bg: string; label: string }> = {
  gmail:      { icon: Mail,         color: 'text-red-400',    bg: 'bg-red-500/20',    label: 'Gmail' },
  email:      { icon: Mail,         color: 'text-red-400',    bg: 'bg-red-500/20',    label: 'Email' },
  slack:      { icon: MessageSquare,color: 'text-purple-400', bg: 'bg-purple-500/20', label: 'Slack' },
  fireflies:  { icon: Video,        color: 'text-orange-400', bg: 'bg-orange-500/20', label: 'Fireflies' },
  transcript: { icon: Video,        color: 'text-orange-400', bg: 'bg-orange-500/20', label: 'Transcript' },
  document:   { icon: FileUp,       color: 'text-blue-400',   bg: 'bg-blue-500/20',   label: 'Document' },
  text:       { icon: FileText,     color: 'text-slate-400',  bg: 'bg-slate-500/20',  label: 'Text' },
};

const NODE_CONFIG = {
  source:      { icon: FileText,   color: 'text-blue-400',   bg: 'bg-blue-500/15',   border: 'border-blue-500/30',   label: 'Source' },
  objective:   { icon: Target,     color: 'text-purple-400', bg: 'bg-purple-500/15', border: 'border-purple-500/30', label: 'Objective' },
  requirement: { icon: ListChecks, color: 'text-emerald-400',bg: 'bg-emerald-500/15',border: 'border-emerald-500/30',label: 'Requirement' },
  task:        { icon: CheckSquare,color: 'text-amber-400',  bg: 'bg-amber-500/15',  border: 'border-amber-500/30',  label: 'Task' },
};

// ── Build a short unique source ID: SRC-1, SRC-2, etc. ────────────────────
function buildSourceId(idx: number) {
  return `SRC-${idx + 1}`;
}

// ── Get source type icon config ────────────────────────────────────────────
function getSourceTypeConfig(type: string) {
  return SOURCE_TYPE_CONFIG[type?.toLowerCase()] ?? SOURCE_TYPE_CONFIG['document'];
}

export function TraceabilityMatrix({ brdId, projectId }: TraceabilityMatrixProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [traceability, setTraceability] = useState<{
    sources: any[];
    objectives: any[];
    requirements: any[];
    tasks: any[];
    links: TraceabilityLink[];
  }>({ sources: [], objectives: [], requirements: [], tasks: [], links: [] });

  const fetchTraceability = async () => {
    setLoading(true);
    try {
      const { data: brd, error: brdError } = await supabase
        .from('brds').select('*').eq('id', brdId).single();
      if (brdError) throw brdError;

      const { data: tasks, error: tasksError } = await supabase
        .from('tasks').select('id, title, requirement_id, status').eq('brd_id', brdId);
      if (tasksError) throw tasksError;

      const rawSources = Array.isArray(brd.raw_sources) ? brd.raw_sources : [];

      // ── Build sources with unique SRC-N identifiers ──────────────────────
      const sources = rawSources.map((s: any, idx: number) => ({
        id:      buildSourceId(idx),          // SRC-1, SRC-2 …
        srcKey:  `source-${idx}`,
        name:    s.name || s.type || `Source ${idx + 1}`,
        type:    s.type || 'document',
        content: typeof s === 'string' ? s : s.content,
        metadata: s.metadata || {},
      }));

      const businessObjectives = Array.isArray(brd.business_objectives) ? brd.business_objectives : [];
      const objectives = businessObjectives.map((o: any) => ({
        id: o.id, name: o.description?.substring(0, 60) || o.id, source: o.source_doc,
      }));

      const funcReqs    = Array.isArray(brd.functional_requirements)     ? brd.functional_requirements     : [];
      const nonFuncReqs = Array.isArray(brd.non_functional_requirements) ? brd.non_functional_requirements : [];

      const requirements = [
        ...funcReqs.map((r: any) => ({
          id: r.id, name: r.title || r.description?.substring(0, 50) || r.id,
          source: r.source_doc, sourceQuote: r.source_quote,
          citationVerified: r.citation_verified, type: 'functional',
        })),
        ...nonFuncReqs.map((r: any) => ({
          id: r.id, name: r.title || r.description?.substring(0, 50) || r.id,
          source: r.source_doc, sourceQuote: r.source_quote,
          citationVerified: r.citation_verified, type: 'non-functional',
        })),
      ];

      // ── Build links ──────────────────────────────────────────────────────
      const links: TraceabilityLink[] = [];

      requirements.forEach((req: any) => {
        // Match source by source_doc field (e.g. "transcript", "email", "SRC-1")
        const matchedSource = sources.find((s: any) =>
          s.type === req.source || s.id === req.source || s.name === req.source
        ) ?? sources[0];

        if (matchedSource) {
          links.push({
            source: {
              id:      matchedSource.id,      // SRC-1
              type:    'source',
              name:    `${matchedSource.id} — ${matchedSource.name}`,
              excerpt: req.sourceQuote,
            },
            target: { id: req.id, type: 'requirement', name: req.name },
          });
        }
      });

      objectives.forEach((obj: any) => {
        const matchedSource = sources.find((s: any) =>
          s.type === obj.source || s.name === obj.source
        ) ?? sources[0];
        if (matchedSource) {
          links.push({
            source: { id: matchedSource.id, type: 'source', name: `${matchedSource.id} — ${matchedSource.name}` },
            target: { id: obj.id, type: 'objective', name: obj.name },
          });
        }
      });

      (tasks || []).forEach((task: any) => {
        if (task.requirement_id) {
          const req = requirements.find((r: any) => r.id === task.requirement_id);
          if (req) {
            links.push({
              source: { id: req.id, type: 'requirement', name: req.name },
              target: { id: task.id, type: 'task', name: task.title },
            });
          }
        }
      });

      setTraceability({ sources, objectives, requirements, tasks: tasks || [], links });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load traceability data' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTraceability(); }, [brdId]);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  const { sources, objectives, requirements, tasks, links } = traceability;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <GitBranch className="w-5 h-5 text-indigo-400" />
            Requirement Traceability
          </CardTitle>
          <Button variant="outline" size="sm" onClick={fetchTraceability}>
            <RefreshCw className="w-4 h-4 mr-2" />Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">

        {/* ── Stat cards ── */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { type: 'source',      count: sources.length },
            { type: 'objective',   count: objectives.length },
            { type: 'requirement', count: requirements.length },
            { type: 'task',        count: tasks.length },
          ].map(({ type, count }) => {
            const cfg  = NODE_CONFIG[type as keyof typeof NODE_CONFIG];
            const Icon = cfg.icon;
            return (
              <div key={type} className={`p-3 rounded-lg border ${cfg.border} ${cfg.bg} text-center`}>
                <Icon className={`w-5 h-5 mx-auto mb-1 ${cfg.color}`} />
                <div className="text-2xl font-bold">{count}</div>
                <div className="text-xs text-muted-foreground">{cfg.label}s</div>
              </div>
            );
          })}
        </div>

        {/* ── Source legend — unique identifiers ── */}
        {sources.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Data Sources</p>
            <div className="grid grid-cols-2 gap-2">
              {sources.map((src: any) => {
                const typeCfg = getSourceTypeConfig(src.type);
                const TypeIcon = typeCfg.icon;
                return (
                  <TooltipProvider key={src.id}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className={`flex items-center gap-2 p-2 rounded-lg border border-border/50 ${typeCfg.bg}`}>
                          {/* Unique identifier badge */}
                          <Badge className={`text-xs font-mono shrink-0 ${typeCfg.bg} ${typeCfg.color} border-0`}>
                            {src.id}
                          </Badge>
                          <TypeIcon className={`w-3.5 h-3.5 shrink-0 ${typeCfg.color}`} />
                          <span className="text-xs truncate">{src.name}</span>
                          <Badge variant="outline" className="text-xs py-0 px-1 ml-auto shrink-0">
                            {typeCfg.label}
                          </Badge>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p className="text-xs font-mono font-bold">{src.id}</p>
                        <p className="text-xs">{src.name}</p>
                        {src.content && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {src.content.substring(0, 120)}…
                          </p>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Flow bar — DARK themed (replaces the white gradient) ── */}
        <div className="p-3 rounded-lg bg-slate-800/60 border border-slate-700/50">
          <div className="flex items-center justify-center gap-2 text-sm">
            <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30 border">
              Sources
            </Badge>
            <ChevronRight className="w-4 h-4 text-slate-500" />
            <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 border">
              Objectives
            </Badge>
            <ChevronRight className="w-4 h-4 text-slate-500" />
            <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 border">
              Requirements
            </Badge>
            <ChevronRight className="w-4 h-4 text-slate-500" />
            <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 border">
              Tasks
            </Badge>
          </div>
        </div>

        {/* ── Links list ── */}
        <ScrollArea className="h-64">
          <div className="space-y-2">
            {links.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <LinkIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">No traceability links found</p>
                <p className="text-xs">Add source citations to requirements to build traceability</p>
              </div>
            ) : (
              links.map((link, idx) => {
                const srcCfg = NODE_CONFIG[link.source.type as keyof typeof NODE_CONFIG];
                const tgtCfg = NODE_CONFIG[link.target.type as keyof typeof NODE_CONFIG];
                const SrcIcon = srcCfg?.icon ?? FileText;
                const TgtIcon = tgtCfg?.icon ?? FileText;

                return (
                  <TooltipProvider key={idx}>
                    <div className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-800/40 border border-slate-700/40 text-sm">
                      {/* Source node */}
                      <div className={`flex items-center gap-1.5 flex-1 min-w-0 px-2 py-1 rounded ${srcCfg?.bg ?? ''}`}>
                        <SrcIcon className={`w-3.5 h-3.5 shrink-0 ${srcCfg?.color ?? ''}`} />
                        <span className="truncate text-xs font-mono font-medium">{link.source.id}</span>
                        <span className="truncate text-xs text-muted-foreground hidden sm:block">
                          {link.source.name.replace(/^SRC-\d+ — /, '')}
                        </span>
                      </div>

                      <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />

                      {/* Target node */}
                      <div className={`flex items-center gap-1.5 flex-1 min-w-0 px-2 py-1 rounded ${tgtCfg?.bg ?? ''}`}>
                        <TgtIcon className={`w-3.5 h-3.5 shrink-0 ${tgtCfg?.color ?? ''}`} />
                        <span className="truncate text-xs font-mono font-medium">{link.target.id}</span>
                        <span className="truncate text-xs text-muted-foreground hidden sm:block">
                          {link.target.name}
                        </span>
                      </div>

                      {/* Citation quote tooltip */}
                      {link.source.excerpt && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="text-xs py-0 px-1.5 shrink-0 cursor-help border-slate-600">
                              quote
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs">
                            <p className="text-xs italic">"{link.source.excerpt}"</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </TooltipProvider>
                );
              })
            )}
          </div>
        </ScrollArea>

        {/* ── Coverage analysis ── */}
        <div className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/40">
          <h4 className="text-sm font-medium mb-3">Coverage Analysis</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground text-xs">Requirements with Sources</span>
                <span className="font-semibold text-xs">
                  {requirements.filter((r: any) => r.source).length} / {requirements.length}
                </span>
              </div>
              {/* Progress bar */}
              <div className="h-1.5 rounded-full bg-slate-700">
                <div
                  className="h-1.5 rounded-full bg-emerald-500 transition-all"
                  style={{ width: requirements.length > 0 ? `${(requirements.filter((r: any) => r.source).length / requirements.length) * 100}%` : '0%' }}
                />
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground text-xs">Requirements with Tasks</span>
                <span className="font-semibold text-xs">
                  {new Set(tasks.filter((t: any) => t.requirement_id).map((t: any) => t.requirement_id)).size} / {requirements.length}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-700">
                <div
                  className="h-1.5 rounded-full bg-amber-500 transition-all"
                  style={{ width: requirements.length > 0 ? `${(new Set(tasks.filter((t: any) => t.requirement_id).map((t: any) => t.requirement_id)).size / requirements.length) * 100}%` : '0%' }}
                />
              </div>
            </div>
          </div>

          {/* Citation verification summary */}
          {requirements.some((r: any) => r.citationVerified === false) && (
            <div className="mt-3 pt-3 border-t border-slate-700/40">
              <div className="flex items-center justify-between text-xs">
                <span className="text-amber-400 font-medium">
                  ⚠ {requirements.filter((r: any) => r.citationVerified === false).length} unverified citations
                </span>
                <span className="text-muted-foreground">Review flagged requirements in the Document tab</span>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
