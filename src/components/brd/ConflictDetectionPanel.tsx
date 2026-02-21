/* src/components/brd/ConflictDetectionPanel */
import { useState, useEffect } from 'react';
import { 
  AlertTriangle, 
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  Lightbulb
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface Conflict {
  id: string;
  type: 'direct' | 'resource' | 'timeline' | 'scope' | 'priority';
  severity: 'high' | 'medium' | 'low';
  requirement1_id: string;
  requirement2_id: string;
  description: string;
  recommendation: string;
}

interface ConflictAnalysis {
  conflicts: Conflict[];
  summary: string;
  risk_level: 'high' | 'medium' | 'low';
}

interface ConflictDetectionPanelProps {
  brdId: string;
}

const severityConfig = {
  high: { 
    label: 'High', 
    className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    icon: '🔴'
  },
  medium: { 
    label: 'Medium', 
    className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    icon: '🟡'
  },
  low: { 
    label: 'Low', 
    className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    icon: '🟢'
  },
};

const typeLabels: Record<string, string> = {
  direct: 'Direct Conflict',
  resource: 'Resource Conflict',
  timeline: 'Timeline Conflict',
  scope: 'Scope Conflict',
  priority: 'Priority Conflict',
};

export function ConflictDetectionPanel({ brdId }: ConflictDetectionPanelProps) {
  const { toast } = useToast();
  const [analysis, setAnalysis] = useState<ConflictAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [expandedConflicts, setExpandedConflicts] = useState<Record<string, boolean>>({});

  const analyzeConflicts = async () => {
    setIsAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('detect-conflicts', {
        body: { brdId },
      });

      if (error) throw error;

      setAnalysis({
        conflicts: data.conflicts || [],
        summary: data.summary || 'No conflicts detected',
        risk_level: data.risk_level || 'low',
      });

      if (data.conflicts?.length > 0) {
        toast({
          variant: 'destructive',
          title: 'Conflicts Detected',
          description: `Found ${data.conflicts.length} potential conflicts in requirements.`,
        });
      } else {
        toast({
          title: 'Analysis Complete',
          description: 'No conflicts detected in your requirements.',
        });
      }
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Analysis Failed',
        description: error.message || 'Failed to analyze conflicts',
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const toggleConflict = (conflictId: string) => {
    setExpandedConflicts(prev => ({
      ...prev,
      [conflictId]: !prev[conflictId]
    }));
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Conflict Detection
          </CardTitle>
          <Button 
            variant="outline" 
            size="sm"
            onClick={analyzeConflicts}
            disabled={isAnalyzing}
          >
            {isAnalyzing ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Analyze
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!analysis ? (
          <div className="text-center py-8 text-muted-foreground">
            <AlertTriangle className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>Click "Analyze" to detect conflicting requirements</p>
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className={`p-3 rounded-lg border ${
              analysis.risk_level === 'high' 
                ? 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900'
                : analysis.risk_level === 'medium'
                ? 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950/20 dark:border-yellow-900'
                : 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-900'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">Risk Level</span>
                <Badge className={severityConfig[analysis.risk_level].className}>
                  {severityConfig[analysis.risk_level].icon} {analysis.risk_level.toUpperCase()}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{analysis.summary}</p>
            </div>

            {/* Conflicts List */}
            {analysis.conflicts.length > 0 ? (
              <div className="space-y-2">
                {analysis.conflicts.map((conflict) => (
                  <Collapsible
                    key={conflict.id}
                    open={expandedConflicts[conflict.id]}
                    onOpenChange={() => toggleConflict(conflict.id)}
                  >
                    <div className="rounded-lg border bg-muted/30">
                      <CollapsibleTrigger asChild>
                        <button className="flex items-center justify-between w-full p-3 text-left hover:bg-muted/50 transition-colors">
                          <div className="flex items-center gap-3">
                            {expandedConflicts[conflict.id] ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                            <Badge variant="outline">{typeLabels[conflict.type]}</Badge>
                            <span className="text-sm font-medium truncate">
                              {conflict.requirement1_id} ↔ {conflict.requirement2_id}
                            </span>
                          </div>
                          <Badge className={severityConfig[conflict.severity].className}>
                            {conflict.severity}
                          </Badge>
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="px-3 pb-3 space-y-3">
                          <p className="text-sm text-muted-foreground pl-8">
                            {conflict.description}
                          </p>
                          <div className="flex items-start gap-2 pl-8 p-2 rounded bg-primary/5 border border-primary/10">
                            <Lightbulb className="w-4 h-4 text-primary mt-0.5" />
                            <div>
                              <span className="text-xs font-medium text-primary">Recommendation</span>
                              <p className="text-sm">{conflict.recommendation}</p>
                            </div>
                          </div>
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground">
                <p className="text-sm">✅ No conflicts detected</p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}