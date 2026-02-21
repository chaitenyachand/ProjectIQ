import { useState, useEffect } from 'react';
import { 
  Users, 
  Loader2,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertCircle,
  ThumbsUp,
  MessageSquare
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface StakeholderSentiment {
  name: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  key_concerns: string[];
  supportive_of: string[];
}

interface Concern {
  concern: string;
  mentioned_by: string;
  severity: 'high' | 'medium' | 'low';
  quote?: string;
}

interface PositiveSignal {
  signal: string;
  mentioned_by: string;
  quote?: string;
}

interface SentimentAnalysis {
  overall: 'positive' | 'neutral' | 'negative' | 'mixed';
  score: number;
  urgency: 'high' | 'medium' | 'low';
  confidence_level: 'high' | 'medium' | 'low';
  stakeholders: StakeholderSentiment[];
  concerns: Concern[];
  positive_signals: PositiveSignal[];
  recommendations: string[];
}

interface SentimentAnalysisPanelProps {
  brdId: string;
}

const sentimentConfig = {
  positive: { 
    label: 'Positive', 
    color: 'text-green-600',
    bgColor: 'bg-green-100 dark:bg-green-900/30',
    icon: TrendingUp
  },
  neutral: { 
    label: 'Neutral', 
    color: 'text-gray-600',
    bgColor: 'bg-gray-100 dark:bg-gray-800/50',
    icon: Minus
  },
  negative: { 
    label: 'Negative', 
    color: 'text-red-600',
    bgColor: 'bg-red-100 dark:bg-red-900/30',
    icon: TrendingDown
  },
  mixed: { 
    label: 'Mixed', 
    color: 'text-amber-600',
    bgColor: 'bg-amber-100 dark:bg-amber-900/30',
    icon: AlertCircle
  },
};

export function SentimentAnalysisPanel({ brdId }: SentimentAnalysisPanelProps) {
  const { toast } = useToast();
  const [sentiment, setSentiment] = useState<SentimentAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const analyzeSentiment = async () => {
    setIsAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-sentiment', {
        body: { brdId },
      });

      if (error) throw error;

      setSentiment(data.sentiment);

      toast({
        title: 'Analysis Complete',
        description: `Overall sentiment: ${data.sentiment.overall}`,
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Analysis Failed',
        description: error.message || 'Failed to analyze sentiment',
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (!sentiment) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="w-5 h-5 text-blue-500" />
              Stakeholder Sentiment
            </CardTitle>
            <Button 
              variant="outline" 
              size="sm"
              onClick={analyzeSentiment}
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
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>Click "Analyze" to understand stakeholder sentiment</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const config = sentimentConfig[sentiment.overall];
  const SentimentIcon = config.icon;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="w-5 h-5 text-blue-500" />
            Stakeholder Sentiment
          </CardTitle>
          <Button 
            variant="outline" 
            size="sm"
            onClick={analyzeSentiment}
            disabled={isAnalyzing}
          >
            {isAnalyzing ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Overall Sentiment */}
        <div className={`p-4 rounded-lg ${config.bgColor}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <SentimentIcon className={`w-5 h-5 ${config.color}`} />
              <span className={`font-semibold ${config.color}`}>
                {config.label} Sentiment
              </span>
            </div>
            <span className="text-2xl font-bold">{Math.round(sentiment.score * 100)}%</span>
          </div>
          <Progress value={sentiment.score * 100} className="h-2" />
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>Urgency: {sentiment.urgency}</span>
            <span>Confidence: {sentiment.confidence_level}</span>
          </div>
        </div>

        {/* Key Concerns */}
        {sentiment.concerns.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-500" />
              Key Concerns ({sentiment.concerns.length})
            </h4>
            <div className="space-y-2">
              {sentiment.concerns.slice(0, 3).map((concern, idx) => (
                <div key={idx} className="p-2 rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm">{concern.concern}</p>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {concern.severity}
                    </Badge>
                  </div>
                  {concern.quote && (
                    <p className="text-xs text-muted-foreground mt-1 italic">
                      "{concern.quote}"
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    — {concern.mentioned_by}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Positive Signals */}
        {sentiment.positive_signals.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <ThumbsUp className="w-4 h-4 text-green-500" />
              Positive Signals ({sentiment.positive_signals.length})
            </h4>
            <div className="space-y-2">
              {sentiment.positive_signals.slice(0, 3).map((signal, idx) => (
                <div key={idx} className="p-2 rounded bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900">
                  <p className="text-sm">{signal.signal}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    — {signal.mentioned_by}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recommendations */}
        {sentiment.recommendations && sentiment.recommendations.length > 0 && (
          <div className="p-3 rounded-lg bg-primary/5 border border-primary/10">
            <h4 className="text-sm font-medium mb-2">💡 Recommendations</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              {sentiment.recommendations.slice(0, 3).map((rec, idx) => (
                <li key={idx}>• {rec}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
