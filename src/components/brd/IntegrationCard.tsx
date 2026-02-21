import { useState } from 'react';
import { 
  Mail, 
  MessageSquare, 
  Video, 
  CheckCircle, 
  AlertCircle,
  Loader2,
  ExternalLink,
  Database,
  Wifi,
  WifiOff
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface IntegrationStatus {
  provider: string;
  name: string;
  description: string;
  oauthReady: boolean;
  liveEnabled: boolean;
  connected: boolean;
  mockAvailable: boolean;
  scopes?: string[];
  accountEmail?: string | null;
  workspaceName?: string | null;
  uploadSupported?: boolean;
}

interface IntegrationCardProps {
  integration: IntegrationStatus;
  onConnect: (provider: string) => void;
  onFetchData: (provider: string, useMock: boolean) => void;
  isLoading?: boolean;
}

const iconMap: Record<string, React.ComponentType<any>> = {
  gmail: Mail,
  slack: MessageSquare,
  fireflies: Video,
};

const colorMap: Record<string, { icon: string; bg: string; border: string }> = {
  gmail: {
    icon: 'text-red-500',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20'
  },
  slack: {
    icon: 'text-purple-500',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/20'
  },
  fireflies: {
    icon: 'text-orange-500',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/20'
  },
};

export function IntegrationCard({ 
  integration, 
  onConnect, 
  onFetchData, 
  isLoading 
}: IntegrationCardProps) {
  const Icon = iconMap[integration.provider] || Database;
  const colors = colorMap[integration.provider] || colorMap.gmail;

  const getStatusBadge = () => {
    if (integration.liveEnabled && integration.connected) {
      return (
        <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
          <Wifi className="w-3 h-3 mr-1" />
          Live
        </Badge>
      );
    }
    if (integration.mockAvailable) {
      return (
        <Badge variant="outline" className="border-blue-500/30 text-blue-400">
          <Database className="w-3 h-3 mr-1" />
          Mock Mode
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="border-muted-foreground/30">
        <WifiOff className="w-3 h-3 mr-1" />
        Not Connected
      </Badge>
    );
  };

  return (
    <Card className={`transition-all hover:shadow-md border ${colors.border}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className={`p-2.5 rounded-xl ${colors.bg}`}>
              <Icon className={`w-5 h-5 ${colors.icon}`} />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">{integration.name}</h3>
                {getStatusBadge()}
              </div>
              <p className="text-sm text-muted-foreground">
                {integration.description}
              </p>
              
              {/* Connection info */}
              {integration.accountEmail && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <CheckCircle className="w-3 h-3 text-emerald-500" />
                  {integration.accountEmail}
                </p>
              )}
              {integration.workspaceName && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <CheckCircle className="w-3 h-3 text-emerald-500" />
                  {integration.workspaceName}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* OAuth Ready Indicator */}
        {integration.oauthReady && !integration.liveEnabled && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="mt-3 p-2 rounded-lg bg-muted/50 border border-dashed text-xs text-muted-foreground flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>OAuth integration ready</span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p>OAuth endpoints are configured with proper scopes. Live sync will be enabled when credentials are added.</p>
                {integration.scopes && (
                  <div className="mt-2 text-xs opacity-75">
                    <p className="font-medium">Required scopes:</p>
                    <ul className="list-disc list-inside">
                      {integration.scopes.slice(0, 2).map(scope => (
                        <li key={scope} className="truncate">{scope.split('/').pop()}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Upload Support for Fireflies */}
        {integration.uploadSupported && (
          <div className="mt-3 p-2 rounded-lg bg-orange-500/10 border border-orange-500/20 text-xs text-orange-300 flex items-center gap-2">
            <Video className="w-3.5 h-3.5" />
            <span>Upload transcripts or paste text directly</span>
          </div>
        )}

        {/* Actions */}
        <div className="mt-4 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => onFetchData(integration.provider, true)}
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <Database className="w-3.5 h-3.5 mr-1.5" />
            )}
            View Sample Data
          </Button>
          
          {integration.oauthReady && !integration.connected && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onConnect(integration.provider)}
                    disabled={!integration.liveEnabled}
                  >
                    <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                    Connect
                  </Button>
                </TooltipTrigger>
                {!integration.liveEnabled && (
                  <TooltipContent>
                    <p>OAuth credentials not configured yet</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
