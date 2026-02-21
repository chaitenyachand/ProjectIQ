/**
 * components/brd/BRDCopilot.tsx
 *
 * Mentor suggestion #3: humans can edit any BRD section directly (inline editing)
 * Mentor suggestion #4: rename "Natural Language Editor" → "BRD Copilot"
 *
 * Two modes:
 *  1. AI Copilot tab  — type an instruction, Claude rewrites the whole BRD or a section
 *  2. Direct Edit tab — click any field in any section and type directly, save to Supabase
 */

import { useState } from 'react';
import {
  Wand2, Send, Loader2, History, Sparkles,
  Pencil, Save, X, ChevronDown, ChevronUp, Check
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface BRDCopilotProps {
  brdId: string;
  brd: any;             // full BRD object passed from BRDDetail
  onEditComplete: () => void;
}

interface EditHistory {
  instruction: string;
  timestamp: string;
  section?: string;
}

const SUGGESTED_COMMANDS = [
  "Rewrite functional requirements more concisely",
  "Add security non-functional requirements",
  "Make the executive summary more compelling",
  "Add measurable targets to all success metrics",
  "Identify missing stakeholders",
  "Prioritize requirements by business impact",
  "Add assumptions about third-party integrations",
  "Add more detail to the timeline phases",
];

// Which BRD fields a human can directly edit inline
const EDITABLE_SECTIONS = [
  { key: 'executive_summary',         label: 'Executive Summary',         type: 'text' as const },
  { key: 'functional_requirements',   label: 'Functional Requirements',   type: 'array' as const },
  { key: 'non_functional_requirements', label: 'Non-Functional Requirements', type: 'array' as const },
  { key: 'business_objectives',       label: 'Business Objectives',       type: 'array' as const },
  { key: 'assumptions',               label: 'Assumptions & Risks',       type: 'array' as const },
  { key: 'success_metrics',           label: 'Success Metrics',           type: 'array' as const },
];

// ── Inline text editor for a single string field ──────────────────────────────
function InlineTextField({
  label, value, onSave
}: { label: string; value: string; onSave: (v: string) => Promise<void> }) {
  const [editing, setEditing]   = useState(false);
  const [draft, setDraft]       = useState(value);
  const [saving, setSaving]     = useState(false);

  const save = async () => {
    setSaving(true);
    await onSave(draft);
    setSaving(false);
    setEditing(false);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {!editing && (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1" onClick={() => { setDraft(value); setEditing(true); }}>
            <Pencil className="w-3 h-3" />Edit
          </Button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <Textarea value={draft} onChange={e => setDraft(e.target.value)} className="min-h-[80px] text-sm" autoFocus />
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={saving} className="h-7 text-xs gap-1">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)} className="h-7 text-xs gap-1">
              <X className="w-3 h-3" />Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground leading-relaxed">{value || <em>Empty</em>}</p>
      )}
    </div>
  );
}

// ── Inline editor for a single item in an array section ──────────────────────
function InlineArrayItem({
  item, fields, onSave, onDelete
}: {
  item: any;
  fields: string[];
  onSave: (updated: any) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState<any>({ ...item });
  const [saving, setSaving]   = useState(false);

  const save = async () => {
    setSaving(true);
    await onSave(draft);
    setSaving(false);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-2 p-2.5 rounded-lg bg-muted/30 border group">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <Badge variant="outline" className="text-xs py-0">{item.id}</Badge>
            {item.title && <span className="text-sm font-medium truncate">{item.title}</span>}
            {item.priority && (
              <Badge className={`text-xs py-0 ${item.priority === 'high' ? 'bg-red-500/20 text-red-400' : item.priority === 'medium' ? 'bg-amber-500/20 text-amber-400' : 'bg-green-500/20 text-green-400'}`}>
                {item.priority}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">{item.description || item.metric || item.risk || ''}</p>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0"
          onClick={() => { setDraft({ ...item }); setEditing(true); }}>
          <Pencil className="w-3 h-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="p-3 rounded-lg border border-primary/30 bg-primary/5 space-y-2">
      {fields.map(field => (
        <div key={field} className="space-y-1">
          <label className="text-xs font-medium capitalize text-muted-foreground">{field.replace(/_/g, ' ')}</label>
          {field === 'description' || field === 'risk' || field === 'measurement' ? (
            <Textarea
              value={draft[field] || ''}
              onChange={e => setDraft((p: any) => ({ ...p, [field]: e.target.value }))}
              className="text-sm min-h-[60px]"
            />
          ) : (
            <Input
              value={draft[field] || ''}
              onChange={e => setDraft((p: any) => ({ ...p, [field]: e.target.value }))}
              className="text-sm h-8"
            />
          )}
        </div>
      ))}
      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={save} disabled={saving} className="h-7 text-xs gap-1">
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}Save
        </Button>
        <Button size="sm" variant="outline" onClick={() => setEditing(false)} className="h-7 text-xs gap-1">
          <X className="w-3 h-3" />Cancel
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} className="h-7 text-xs text-destructive ml-auto gap-1">
          Delete
        </Button>
      </div>
    </div>
  );
}

// ── Array section editor ──────────────────────────────────────────────────────
const SECTION_FIELDS: Record<string, string[]> = {
  functional_requirements:     ['id', 'title', 'description', 'priority'],
  non_functional_requirements: ['id', 'title', 'description', 'category', 'priority'],
  business_objectives:         ['id', 'description', 'priority'],
  assumptions:                 ['id', 'description', 'risk'],
  success_metrics:             ['id', 'metric', 'target', 'measurement'],
};

function ArraySectionEditor({
  sectionKey, items, onSave
}: { sectionKey: string; items: any[]; onSave: (updated: any[]) => Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const fields = SECTION_FIELDS[sectionKey] || ['id', 'description'];

  const updateItem = async (idx: number, updated: any) => {
    const next = items.map((it, i) => i === idx ? updated : it);
    await onSave(next);
  };

  const deleteItem = async (idx: number) => {
    const next = items.filter((_, i) => i !== idx);
    await onSave(next);
  };

  return (
    <div className="space-y-1">
      <button
        className="w-full flex items-center justify-between text-xs font-medium text-muted-foreground py-1"
        onClick={() => setExpanded(p => !p)}
      >
        <span>{items.length} item{items.length !== 1 ? 's' : ''}</span>
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {expanded && (
        <div className="space-y-1.5">
          {items.map((item, idx) => (
            <InlineArrayItem
              key={item.id || idx}
              item={item}
              fields={fields}
              onSave={(updated) => updateItem(idx, updated)}
              onDelete={() => deleteItem(idx)}
            />
          ))}
          {items.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">No items yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main BRDCopilot component ─────────────────────────────────────────────────
export function BRDCopilot({ brdId, brd, onEditComplete }: BRDCopilotProps) {
  const { toast }     = useToast();
  const [instruction, setInstruction] = useState('');
  const [processing, setProcessing]   = useState(false);
  const [history, setHistory]         = useState<EditHistory[]>([]);
  const [activeTab, setActiveTab]     = useState<'copilot' | 'direct'>('copilot');

  // ── AI Copilot submit ─────────────────────────────────────────────────────
  const handleCopilotSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!instruction.trim()) return;
    setProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('edit-brd-nl', {
        body: { brdId, instruction: instruction.trim() },
      });
      if (error) throw error;

      setHistory(prev => [
        { instruction: instruction.trim(), timestamp: new Date().toISOString() },
        ...prev.slice(0, 9),
      ]);

      toast({ title: 'Edit Applied', description: `BRD updated to version ${data?.newVersion ?? ''}` });
      setInstruction('');
      onEditComplete();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Edit Failed', description: err.message || 'Failed to apply edit' });
    } finally {
      setProcessing(false);
    }
  };

  // ── Direct edit save — patch Supabase directly ────────────────────────────
  const saveField = async (field: string, value: any) => {
    const { error } = await supabase
      .from('brds')
      .update({ [field]: value, updated_at: new Date().toISOString() })
      .eq('id', brdId);

    if (error) {
      toast({ variant: 'destructive', title: 'Save failed', description: error.message });
    } else {
      toast({ title: 'Saved', description: `${field.replace(/_/g, ' ')} updated.` });
      onEditComplete();
    }
  };

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wand2 className="w-5 h-5 text-primary" />
          BRD Copilot
          <Badge variant="outline" className="text-xs font-normal ml-1">AI-assisted editing</Badge>
        </CardTitle>
      </CardHeader>

      <CardContent>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
          <TabsList className="grid grid-cols-2 mb-4 h-8">
            <TabsTrigger value="copilot" className="text-xs">
              <Sparkles className="w-3 h-3 mr-1.5" />AI Instruction
            </TabsTrigger>
            <TabsTrigger value="direct" className="text-xs">
              <Pencil className="w-3 h-3 mr-1.5" />Direct Edit
            </TabsTrigger>
          </TabsList>

          {/* ── AI Copilot Tab ── */}
          <TabsContent value="copilot" className="space-y-4 mt-0">
            <form onSubmit={handleCopilotSubmit} className="flex gap-2">
              <Input
                placeholder="e.g. 'Add performance requirements for API response times'"
                value={instruction}
                onChange={e => setInstruction(e.target.value)}
                disabled={processing}
                className="flex-1"
              />
              <Button type="submit" disabled={processing || !instruction.trim()}>
                {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </form>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Sparkles className="w-3 h-3" />Suggested edits
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTED_COMMANDS.slice(0, 4).map((cmd, i) => (
                  <Badge
                    key={i} variant="secondary"
                    className="cursor-pointer hover:bg-secondary/80 transition-colors"
                    onClick={() => setInstruction(cmd)}
                  >
                    {cmd}
                  </Badge>
                ))}
              </div>
            </div>

            {history.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <History className="w-3 h-3" />Recent edits
                </p>
                <ScrollArea className="h-20">
                  <div className="space-y-1">
                    {history.map((h, i) => (
                      <div key={i} className="text-xs p-2 rounded bg-muted/50 flex items-center justify-between gap-2">
                        <span className="truncate">{h.instruction}</span>
                        <span className="text-muted-foreground whitespace-nowrap">
                          {new Date(h.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </TabsContent>

          {/* ── Direct Edit Tab ── */}
          <TabsContent value="direct" className="space-y-4 mt-0">
            <p className="text-xs text-muted-foreground">
              Click any field to edit it directly. Changes save immediately to the database.
            </p>

            <ScrollArea className="h-80 pr-2">
              <div className="space-y-5">
                {/* Executive Summary — plain text */}
                <div className="space-y-1">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Executive Summary
                  </span>
                  <InlineTextField
                    label=""
                    value={brd?.executive_summary || ''}
                    onSave={(v) => saveField('executive_summary', v)}
                  />
                </div>

                {/* Array sections */}
                {EDITABLE_SECTIONS.filter(s => s.type === 'array').map(section => (
                  <div key={section.key} className="space-y-1">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {section.label}
                    </span>
                    <ArraySectionEditor
                      sectionKey={section.key}
                      items={brd?.[section.key] || []}
                      onSave={(updated) => saveField(section.key, updated)}
                    />
                  </div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// Keep backward-compatible export so BRDDetail import doesn't break
export { BRDCopilot as NaturalLanguageEditor };
