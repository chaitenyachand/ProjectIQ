/**
 * components/brd/GmailLabelSelector.tsx
 *
 * Mentor suggestion #2:
 * Instead of importing ALL gmail, let user pick specific labels
 * (e.g. "ProjectAlpha", "Client/Acme") to import from.
 */

import { useState, useEffect } from 'react';
import {
  Mail, Check, Loader2, Tag, AlertCircle,
  ChevronDown, ChevronUp, X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';

const PYTHON_BACKEND = import.meta.env.VITE_PYTHON_BACKEND_URL || 'http://127.0.0.1:8000';

export interface GmailLabel {
  id: string;
  name: string;
  messageCount?: number;
  type: 'system' | 'user';
}

interface GmailLabelSelectorProps {
  userId: string;
  onConfirmed: (labels: GmailLabel[], maxEmails: number) => void;
  onCancel: () => void;
}

const HIDDEN_LABELS = new Set([
  'CHAT','SENT','INBOX','SPAM','TRASH','UNREAD','STARRED',
  'IMPORTANT','DRAFT','CATEGORY_PROMOTIONS','CATEGORY_SOCIAL',
  'CATEGORY_UPDATES','CATEGORY_FORUMS','CATEGORY_PERSONAL',
]);

export function GmailLabelSelector({ userId, onConfirmed, onCancel }: GmailLabelSelectorProps) {
  const { toast }  = useToast();
  const [labels, setLabels]         = useState<GmailLabel[]>([]);
  const [loading, setLoading]       = useState(true);
  const [selected, setSelected]     = useState<Set<string>>(new Set());
  const [search, setSearch]         = useState('');
  const [maxEmails, setMaxEmails]   = useState(50);
  const [showSystem, setShowSystem] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(
          `${PYTHON_BACKEND}/api/integrations/gmail/labels?user_id=${userId}`
        );
        if (!resp.ok) throw new Error();
        const data = await resp.json();
        const all: GmailLabel[] = (data.labels || [])
          .filter((l: GmailLabel) => !HIDDEN_LABELS.has(l.name))
          .sort((a: GmailLabel, b: GmailLabel) => {
            if (a.type === 'user' && b.type !== 'user') return -1;
            if (b.type === 'user' && a.type !== 'user') return 1;
            return a.name.localeCompare(b.name);
          });
        setLabels(all);
      } catch {
        toast({ variant: 'destructive', title: 'Could not load Gmail labels', description: 'Make sure Gmail is connected.' });
      } finally { setLoading(false); }
    })();
  }, [userId]);

  const toggle = (id: string) =>
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleConfirm = () => {
    if (selected.size === 0) { toast({ variant: 'destructive', title: 'Select at least one label' }); return; }
    onConfirmed(labels.filter(l => selected.has(l.id)), maxEmails);
  };

  const userLabels   = labels.filter(l => l.type === 'user');
  const systemLabels = labels.filter(l => l.type === 'system');
  const filtered     = (list: GmailLabel[]) => list.filter(l => l.name.toLowerCase().includes(search.toLowerCase()));
  const visible      = [...filtered(userLabels), ...(showSystem ? filtered(systemLabels) : [])];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="p-2 rounded-lg bg-red-500/10"><Mail className="w-5 h-5 text-red-500" /></div>
        <div>
          <h3 className="font-semibold text-sm">Select Gmail Labels to Import</h3>
          <p className="text-xs text-muted-foreground">Only emails with these labels will be analysed — not your full inbox.</p>
        </div>
      </div>

      <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
        <AlertCircle className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-300 leading-relaxed">
          In Gmail, create a label like <strong>"ProjectAlpha"</strong> and apply it to relevant emails.
          Only those will be analysed here — your personal mail stays private.
        </p>
      </div>

      <Input placeholder="Search labels..." value={search} onChange={e => setSearch(e.target.value)} className="h-8 text-sm" />

      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : visible.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground">
          <Tag className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No labels found.</p>
          <p className="text-xs mt-1">Create labels in Gmail and apply them to project emails first.</p>
        </div>
      ) : (
        <ScrollArea className="h-48 pr-1">
          <div className="space-y-1">
            {visible.map(label => (
              <div key={label.id} onClick={() => toggle(label.id)}
                className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-all text-sm select-none ${selected.has(label.id) ? 'bg-primary/10 border-primary/40' : 'bg-muted/30 border-transparent hover:border-muted-foreground/20'}`}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <Checkbox checked={selected.has(label.id)} onCheckedChange={() => toggle(label.id)} onClick={e => e.stopPropagation()} />
                  <Tag className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate">{label.name}</span>
                  {label.type === 'system' && <Badge variant="outline" className="text-xs py-0 px-1 shrink-0">system</Badge>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {label.messageCount !== undefined && <span className="text-xs text-muted-foreground">{label.messageCount}</span>}
                  {selected.has(label.id) && <Check className="w-3.5 h-3.5 text-primary" />}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      {systemLabels.length > 0 && (
        <button className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground" onClick={() => setShowSystem(p => !p)}>
          {showSystem ? <><ChevronUp className="w-3 h-3" />Hide system labels</> : <><ChevronDown className="w-3 h-3" />Show {systemLabels.length} system labels</>}
        </button>
      )}

      <div className="space-y-1.5">
        <div className="flex justify-between">
          <Label className="text-xs text-muted-foreground">Max emails per label</Label>
          <span className="text-xs font-semibold text-primary">{maxEmails}</span>
        </div>
        <input type="range" min={10} max={200} step={10} value={maxEmails} onChange={e => setMaxEmails(Number(e.target.value))} className="w-full accent-primary h-1.5" />
        <div className="flex justify-between text-xs text-muted-foreground"><span>10</span><span>200</span></div>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {labels.filter(l => selected.has(l.id)).map(l => (
            <Badge key={l.id} className="text-xs bg-primary/15 text-primary border-primary/30 cursor-pointer gap-1" onClick={() => toggle(l.id)}>
              {l.name}<X className="w-2.5 h-2.5" />
            </Badge>
          ))}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button variant="outline" size="sm" className="flex-1" onClick={onCancel}>Cancel</Button>
        <Button size="sm" className="flex-1" disabled={selected.size === 0 || loading} onClick={handleConfirm}>
          <Mail className="w-4 h-4 mr-2" />Import from {selected.size} label{selected.size !== 1 ? 's' : ''}
        </Button>
      </div>
    </div>
  );
}
