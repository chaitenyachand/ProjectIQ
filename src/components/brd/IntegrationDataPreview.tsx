import { useState } from 'react';
import {
  Mail, MessageSquare, Video, FileText,
  Clock, User, Hash, CheckCircle, AlertCircle,
  Check, ArrowLeft, X
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface IntegrationDataPreviewProps {
  provider: string;
  data: any[];
  isMock: boolean;
  onAddToSources: (items: any[]) => void;
  onClose: () => void;
}

function safeDate(raw: any): string {
  if (!raw) return '';
  try {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? String(raw).slice(0, 30)
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return String(raw).slice(0, 30); }
}

function safeDateTime(raw: any): string {
  if (!raw) return '';
  try {
    const n = parseFloat(raw);
    const d = !isNaN(n) && n > 1e9 ? new Date(n * 1000) : new Date(raw);
    return isNaN(d.getTime()) ? String(raw).slice(0, 30)
      : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return String(raw).slice(0, 30); }
}

function clean(v: any): string {
  if (!v) return '';
  const s = String(v);
  if (!s.includes('&#') && !s.includes('&amp;') && !s.includes('&nbsp;')) return s;
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ').replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

export function IntegrationDataPreview({ provider, data, isMock, onAddToSources, onClose }: IntegrationDataPreviewProps) {
  const getId = (item: any, i: number) => item.id || item.ts || String(i);

  const [selected, setSelected] = useState<Set<string>>(
    new Set(data.map((item, i) => getId(item, i)))
  );
  const [detailItem, setDetailItem] = useState<any | null>(null);

  const toggle = (id: string) =>
    setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleAll = () =>
    selected.size === data.length
      ? setSelected(new Set())
      : setSelected(new Set(data.map((item, i) => getId(item, i))));

  const handleAdd = () =>
    onAddToSources(data.filter((item, i) => selected.has(getId(item, i))));

  // ── Gmail card ────────────────────────────────────────────────────────────
  const GmailCard = ({ item, id }: { item: any; id: string }) => {
    const on = selected.has(id);
    return (
      <div
        className={`rounded-lg border transition-all ${on ? 'border-red-500/40 bg-red-500/5' : 'border-border bg-muted/10 opacity-55'}`}
      >
        <div className="flex items-start gap-2.5 p-3">
          <Checkbox checked={on} onCheckedChange={() => toggle(id)} onClick={e => e.stopPropagation()} className="mt-0.5 shrink-0" />
          <div
            className="flex-1 min-w-0 cursor-pointer"
            onClick={() => setDetailItem({ ...item, _provider: 'gmail' })}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Mail className="w-3.5 h-3.5 text-red-500 shrink-0" />
              <span className="font-medium text-sm truncate">{clean(item.subject) || '(no subject)'}</span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
              {(item.from || item.sender) && (
                <span className="flex items-center gap-1 min-w-0">
                  <User className="w-3 h-3 shrink-0" />
                  <span className="truncate max-w-[180px]">{clean(item.from || item.sender)}</span>
                </span>
              )}
              {(item.date || item.timestamp) && (
                <span className="flex items-center gap-1 shrink-0">
                  <Clock className="w-3 h-3" />{safeDate(item.date || item.timestamp)}
                </span>
              )}
            </div>
            {(item.body || item.snippet || item.content) && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                {clean(item.body || item.snippet || item.content)}
              </p>
            )}
            {item.labels && item.labels.length > 0 && (
              <div className="flex gap-1 mt-1.5 flex-wrap">
                {item.labels.slice(0, 3).map((l: string) => (
                  <Badge key={l} variant="outline" className="text-[10px] px-1.5 py-0">{l.replace('CATEGORY_', '').toLowerCase()}</Badge>
                ))}
              </div>
            )}
            <p className="text-[10px] text-primary/60 mt-1.5">Click to read full email →</p>
          </div>
        </div>
      </div>
    );
  };

  // ── Slack card ────────────────────────────────────────────────────────────
  const SlackCard = ({ item, id }: { item: any; id: string }) => {
    const on = selected.has(id);
    return (
      <div
        className={`rounded-lg border cursor-pointer transition-all ${on ? 'border-purple-500/40 bg-purple-500/5' : 'border-border bg-muted/10 opacity-55'}`}
        onClick={() => toggle(id)}
      >
        <div className="flex items-start gap-2.5 p-3">
          <Checkbox checked={on} onCheckedChange={() => toggle(id)} onClick={e => e.stopPropagation()} className="mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Hash className="w-3.5 h-3.5 text-purple-500 shrink-0" />
              <span className="text-xs font-medium text-purple-400 truncate">{item.channel || 'channel'}</span>
              {item.thread_count > 0 && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{item.thread_count} replies</Badge>}
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><User className="w-3 h-3" />{item.user_name || 'Unknown'}</span>
              {(item.timestamp || item.ts) && (
                <span className="flex items-center gap-1 shrink-0"><Clock className="w-3 h-3" />{safeDateTime(item.timestamp || item.ts)}</span>
              )}
            </div>
            {(item.text || item.content) && (
              <p className="text-xs mt-1 line-clamp-3 leading-relaxed">{clean(item.text || item.content)}</p>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ── Fireflies card ────────────────────────────────────────────────────────
  const FirefliesCard = ({ item, id }: { item: any; id: string }) => {
    const on      = selected.has(id);
    const overview = clean(typeof item.overview === 'string' ? item.overview : (item.summary || item.content || ''));
    return (
      <div
        className={`rounded-lg border transition-all ${on ? 'border-orange-500/40 bg-orange-500/5' : 'border-border bg-muted/10 opacity-55'}`}
      >
        <div className="flex items-start gap-2.5 p-3">
          <Checkbox checked={on} onCheckedChange={() => toggle(id)} onClick={e => e.stopPropagation()} className="mt-0.5 shrink-0" />
          <div
            className="flex-1 min-w-0 cursor-pointer"
            onClick={() => setDetailItem({ ...item, _provider: 'fireflies' })}
          >
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <Video className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                <span className="font-medium text-sm truncate">{clean(item.title) || 'Untitled Meeting'}</span>
              </div>
              {item.duration != null && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                  {typeof item.duration === 'number' ? `${Math.round(item.duration / 60)}m` : item.duration}
                </Badge>
              )}
            </div>
            {item.date && <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1"><Clock className="w-3 h-3" />{safeDate(item.date)}</p>}
            {overview && <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">{overview}</p>}
            {item.action_items?.length > 0 && (
              <p className="text-xs text-emerald-400 mt-1 flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />{item.action_items.length} action items
              </p>
            )}
            {item.keywords?.length > 0 && (
              <div className="flex gap-1 mt-1.5 flex-wrap">
                {item.keywords.slice(0, 4).map((k: string) => <Badge key={k} variant="outline" className="text-[10px] px-1.5 py-0">{k}</Badge>)}
              </div>
            )}
            <p className="text-[10px] text-primary/60 mt-1.5">Click to view full transcript →</p>
          </div>
        </div>
      </div>
    );
  };

  const renderCard = (item: any, i: number) => {
    const id = getId(item, i);
    switch (provider) {
      case 'gmail':     return <GmailCard key={id} item={item} id={id} />;
      case 'slack':     return <SlackCard key={id} item={item} id={id} />;
      case 'fireflies': return <FirefliesCard key={id} item={item} id={id} />;
      default: return null;
    }
  };

  const meta: Record<string, { name: string; icon: any; color: string }> = {
    gmail:     { name: 'Gmail',     icon: Mail,          color: 'text-red-500' },
    slack:     { name: 'Slack',     icon: MessageSquare, color: 'text-purple-500' },
    fireflies: { name: 'Fireflies', icon: Video,         color: 'text-orange-500' },
  };
  const { name, icon: Icon, color } = meta[provider] ?? { name: provider, icon: FileText, color: '' };

  return (
    <>
      <Card className="border-2">
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon className={`w-4 h-4 ${color}`} />
              {name} — Select items to add
            </CardTitle>
            <Badge variant="outline" className="text-xs">{selected.size} / {data.length}</Badge>
          </div>
          <div className="flex items-center justify-between pt-1">
            <Button variant="ghost" size="sm" className="h-7 text-xs px-2 gap-1.5" onClick={toggleAll}>
              <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${selected.size === data.length ? 'bg-primary border-primary' : 'border-muted-foreground'}`}>
                {selected.size === data.length && <Check className="w-2.5 h-2.5 text-white" />}
              </div>
              {selected.size === data.length ? 'Deselect all' : 'Select all'}
            </Button>
            {isMock && <span className="flex items-center gap-1 text-xs text-blue-400"><AlertCircle className="w-3 h-3" />Sample data</span>}
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <ScrollArea className="h-[380px]">
            <div className="space-y-2 pr-3">{data.map(renderCard)}</div>
          </ScrollArea>
          <div className="flex gap-2 pt-2 border-t">
            <Button className="flex-1" onClick={handleAdd} disabled={selected.size === 0}>
              <FileText className="w-4 h-4 mr-2" />
              Add {selected.size} item{selected.size !== 1 ? 's' : ''} to BRD Sources
            </Button>
            <Button variant="outline" onClick={onClose}>Close</Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Full Email / Transcript Detail Dialog ── */}
      <Dialog open={!!detailItem} onOpenChange={o => !o && setDetailItem(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base pr-8">
              {detailItem?._provider === 'gmail'
                ? <><Mail className="w-4 h-4 text-red-500 shrink-0" /><span className="truncate">{clean(detailItem?.subject) || '(no subject)'}</span></>
                : <><Video className="w-4 h-4 text-orange-500 shrink-0" /><span className="truncate">{clean(detailItem?.title) || 'Meeting'}</span></>
              }
            </DialogTitle>
          </DialogHeader>

          {detailItem && (
            <ScrollArea className="flex-1 min-h-0">
              <div className="space-y-4 pr-2">
                {/* Metadata */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground border-b pb-3">
                  {detailItem._provider === 'gmail' && (
                    <>
                      {detailItem.from && <span className="flex items-center gap-1"><User className="w-3 h-3" /><span className="font-medium">From:</span> {clean(detailItem.from)}</span>}
                      {detailItem.to && <span className="flex items-center gap-1"><span className="font-medium">To:</span> {clean(detailItem.to)}</span>}
                      {detailItem.date && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{safeDate(detailItem.date)}</span>}
                    </>
                  )}
                  {detailItem._provider === 'fireflies' && (
                    <>
                      {detailItem.date && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{safeDate(detailItem.date)}</span>}
                      {detailItem.duration && <span>{Math.round(detailItem.duration / 60)} min</span>}
                    </>
                  )}
                </div>

                {/* Body / Overview */}
                {(detailItem.body || detailItem.snippet || detailItem.overview || detailItem.content) && (
                  <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {clean(detailItem.body || detailItem.overview || detailItem.content || detailItem.snippet)}
                  </div>
                )}

                {/* Action items for Fireflies */}
                {detailItem.action_items?.length > 0 && (
                  <div className="space-y-2 border-t pt-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Action Items</p>
                    <ul className="space-y-1.5">
                      {detailItem.action_items.map((a: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />{a}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Keywords */}
                {detailItem.keywords?.length > 0 && (
                  <div className="space-y-2 border-t pt-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Keywords</p>
                    <div className="flex flex-wrap gap-1.5">
                      {detailItem.keywords.map((k: string) => <Badge key={k} variant="outline" className="text-xs">{k}</Badge>)}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t shrink-0">
            {detailItem && (
              <Button size="sm" variant="outline"
                onClick={() => {
                  const id = getId(detailItem, data.indexOf(detailItem));
                  if (!selected.has(id)) toggle(id);
                  setDetailItem(null);
                }}>
                {selected.has(getId(detailItem, data.indexOf(detailItem))) ? '✓ Selected' : 'Select this item'}
              </Button>
            )}
            <Button size="sm" onClick={() => setDetailItem(null)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
