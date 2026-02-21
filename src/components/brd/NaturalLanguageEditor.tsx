import { useState } from 'react';
import {
  Wand2,
  Send,
  Loader2,
  History,
  Sparkles
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface EditHistory {
  instruction: string;
  timestamp: string;
  section?: string;
}

interface NaturalLanguageEditorProps {
  brdId: string;
  section?: string;
  onEditComplete: () => void;
}

const suggestedCommands = [
  "Rewrite functional requirements more concisely",
  "Add security-related non-functional requirements",
  "Make the executive summary more compelling",
  "Add more detail to the timeline phases",
  "Identify missing stakeholders",
  "Strengthen success metrics with measurable targets",
  "Add assumptions about third-party integrations",
  "Prioritize requirements by business impact",
];

export function NaturalLanguageEditor({
  brdId,
  section,
  onEditComplete,
}: NaturalLanguageEditorProps) {
  const { toast } = useToast();

  const [instruction, setInstruction] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [editHistory, setEditHistory] = useState<EditHistory[]>([]);

  // 🔹 Existing NL edit handler
  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!instruction.trim()) return;

    setIsProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('edit-brd-nl', {
        body: {
          brdId,
          instruction: instruction.trim(),
          section,
        },
      });

      if (error) throw error;

      setEditHistory(prev => [
        {
          instruction: instruction.trim(),
          timestamp: new Date().toISOString(),
          section,
        },
        ...prev.slice(0, 9),
      ]);

      toast({
        title: 'Edit Applied',
        description: `BRD updated to version ${data?.newVersion ?? ''}`,
      });

      setInstruction('');
      onEditComplete();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Edit Failed',
        description: error.message || 'Failed to apply edit',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // 🔥 NEW: Regenerate Requirements Handler
  const handleRegenerate = async () => {
    setIsProcessing(true);
    try {
      const { error } = await supabase.functions.invoke(
        'generate-brd-requirements',
        {
          body: { brdId },
        }
      );

      if (error) throw error;

      toast({
        title: 'Requirements Generated',
        description: 'BRD has been populated from connected data sources.',
      });

      onEditComplete();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Generation Failed',
        description: error.message || 'Failed to generate requirements',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInstruction(suggestion);
  };

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      {/* 🔥 HEADER WITH REGENERATE BUTTON */}
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wand2 className="w-5 h-5 text-primary" />
            Natural Language Editor
            {section && (
              <Badge variant="outline" className="ml-2 text-xs">
                Editing: {section.replace(/_/g, ' ')}
              </Badge>
            )}
          </CardTitle>

          <Button
            variant="outline"
            size="sm"
            onClick={handleRegenerate}
            disabled={isProcessing}
            className="flex items-center gap-1"
          >
            {isProcessing ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            Regenerate
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* NL Instruction Input */}
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            placeholder="e.g., 'Add performance requirements for API response times'"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            disabled={isProcessing}
            className="flex-1"
          />
          <Button type="submit" disabled={isProcessing || !instruction.trim()}>
            {isProcessing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </form>

        {/* Suggested Commands */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            Suggested edits
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestedCommands.slice(0, 4).map((cmd, idx) => (
              <Badge
                key={idx}
                variant="secondary"
                className="cursor-pointer hover:bg-secondary/80 transition-colors"
                onClick={() => handleSuggestionClick(cmd)}
              >
                {cmd}
              </Badge>
            ))}
          </div>
        </div>

        {/* Edit History */}
        {editHistory.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <History className="w-3 h-3" />
              Recent edits
            </p>
            <ScrollArea className="h-24">
              <div className="space-y-1">
                {editHistory.map((edit, idx) => (
                  <div
                    key={idx}
                    className="text-xs p-2 rounded bg-muted/50 flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{edit.instruction}</span>
                    <span className="text-muted-foreground whitespace-nowrap">
                      {new Date(edit.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Existing helper (unchanged)
export async function rewriteText(text: string) {
  const { data } = await supabase.functions.invoke('rewrite-brd', {
    body: {
      text,
      instruction: 'Rewrite this professionally for a BRD',
    },
  });

  return data.result;
}