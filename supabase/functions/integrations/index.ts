import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ============================================
// OAUTH CONFIGURATION (ready for real credentials)
// ============================================
const INTEGRATION_CONFIG = {
  gmail: {
    enabled: !!Deno.env.get("GMAIL_OAUTH_ENABLED"),
    clientId: Deno.env.get("GMAIL_CLIENT_ID"),
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.metadata"
    ],
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    redirectUri: "/integrations/gmail/callback"
  },
  slack: {
    enabled: !!Deno.env.get("SLACK_OAUTH_ENABLED"),
    clientId: Deno.env.get("SLACK_CLIENT_ID"),
    scopes: [
      "channels:history",
      "channels:read",
      "users:read"
    ],
    authUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    redirectUri: "/integrations/slack/callback"
  },
  fireflies: {
    enabled: !!Deno.env.get("FIREFLIES_API_KEY"),
    apiKey: Deno.env.get("FIREFLIES_API_KEY"),
    apiUrl: "https://api.fireflies.ai/graphql"
  }
};

// ============================================
// MOCK DATA PROVIDERS (realistic sample data)
// ============================================
function getMockGmailData() {
  return [
    {
      id: "gmail_001",
      from: "product.manager@acme.com",
      to: "dev-team@acme.com",
      subject: "Q4 Feature Requirements - Payment System",
      body: `Hi team,

After the stakeholder meeting, here are the key requirements for the payment system:

1. Users must be able to pay via credit card, debit card, and PayPal
2. All transactions need PCI DSS compliance
3. Implement 3D Secure for fraud prevention
4. Support for recurring billing (monthly/yearly)
5. Real-time payment notifications via webhook
6. Admin dashboard for transaction monitoring

Deadline: End of Q4 (December 15th)
Priority: HIGH

Let me know if you have questions.

Best,
Sarah (Product Manager)`,
      timestamp: "2024-06-15T10:30:00Z",
      labels: ["inbox", "requirements"],
      isRead: true
    },
    {
      id: "gmail_002",
      from: "cto@acme.com",
      to: "engineering@acme.com",
      subject: "Security Requirements Update",
      body: `Team,

Following the security audit, we need to add these non-functional requirements:

- All API endpoints must use HTTPS with TLS 1.3
- Implement rate limiting (100 requests/minute per user)
- Add audit logging for all sensitive operations
- Session timeout after 30 minutes of inactivity
- Two-factor authentication for admin users

These are mandatory for SOC 2 compliance.

- James (CTO)`,
      timestamp: "2024-06-14T14:45:00Z",
      labels: ["inbox", "security"],
      isRead: true
    },
    {
      id: "gmail_003",
      from: "client@enterprise.com",
      to: "sales@acme.com",
      subject: "RE: Contract Discussion - Custom Features",
      body: `Hi,

Thanks for the proposal. We'd like to add these custom requirements:

1. Single Sign-On (SSO) integration with our Okta instance
2. Custom branding (logo, colors, fonts)
3. Data residency in EU region (GDPR compliance)
4. 99.9% uptime SLA
5. Dedicated support channel

Budget: $150,000/year
Timeline: Go-live by March 2025

Please confirm feasibility.

Regards,
Enterprise Client`,
      timestamp: "2024-06-13T09:15:00Z",
      labels: ["inbox", "client"],
      isRead: false
    }
  ];
}

function getMockSlackData() {
  return [
    {
      id: "slack_001",
      channel: "#backend-dev",
      user: "lead_developer",
      userName: "Alex Chen",
      message: "We need to implement retry logic for payment failures. Current implementation fails silently which is causing customer complaints.",
      timestamp: "2024-06-15T11:20:00Z",
      reactions: [{ name: "+1", count: 3 }],
      thread_count: 5
    },
    {
      id: "slack_002",
      channel: "#product",
      user: "product_owner",
      userName: "Maria Garcia",
      message: "User research shows 70% of users want dark mode. Adding to backlog as P2. @design team please create mockups by Friday.",
      timestamp: "2024-06-15T10:45:00Z",
      reactions: [{ name: "eyes", count: 2 }],
      thread_count: 8
    },
    {
      id: "slack_003",
      channel: "#incidents",
      user: "devops_lead",
      userName: "Sam Wilson",
      message: "⚠️ Database connection pool exhausted during peak hours yesterday. Need to increase pool size from 20 to 50 connections. Also recommend implementing connection queuing.",
      timestamp: "2024-06-14T16:30:00Z",
      reactions: [{ name: "warning", count: 1 }],
      thread_count: 12
    },
    {
      id: "slack_004",
      channel: "#general",
      user: "ceo",
      userName: "David Park",
      message: "Big announcement: We've secured Series B funding! This means we can accelerate the mobile app development. Timeline moved up to Q3.",
      timestamp: "2024-06-14T09:00:00Z",
      reactions: [{ name: "tada", count: 25 }, { name: "rocket", count: 18 }],
      thread_count: 45
    },
    {
      id: "slack_005",
      channel: "#qa",
      user: "qa_lead",
      userName: "Priya Sharma",
      message: "Found critical bug: Payment form doesn't validate CVV on Safari. Users can submit without entering CVV. @frontend-dev please prioritize fix.",
      timestamp: "2024-06-13T15:10:00Z",
      reactions: [{ name: "bug", count: 2 }],
      thread_count: 7
    }
  ];
}

function getMockFirefliesData() {
  return [
    {
      id: "fireflies_001",
      title: "Sprint Planning - June 15",
      date: "2024-06-15",
      duration: "45 min",
      participants: ["Sarah (PM)", "Alex (Dev Lead)", "Maria (Design)", "Sam (DevOps)"],
      summary: "Discussed Q3 roadmap and sprint goals. Key decisions: prioritize payment system, defer mobile app to Q4.",
      transcript: `Sarah: Let's review what we need to accomplish this sprint.

Alex: The payment integration is our top priority. We need to support Stripe and PayPal initially.

Maria: I've completed the payment flow mockups. Should I share them in Figma?

Sarah: Yes please. Also, the client wants the checkout to be under 3 clicks.

Sam: From infrastructure side, we'll need to set up PCI-compliant hosting. I recommend AWS with dedicated VPC.

Alex: Good point. We should also implement idempotency keys for payment requests to handle network failures.

Sarah: Timeline check - can we have MVP by end of sprint?

Alex: Realistic estimate is 2 weeks for basic flow, 3 weeks for full feature set.

Sarah: Let's aim for basic flow this sprint, full features next sprint.

[Action Items]
1. Alex to start Stripe integration
2. Maria to share Figma designs today
3. Sam to provision AWS infrastructure
4. Sarah to update stakeholders on timeline`,
      actionItems: [
        "Alex to start Stripe integration",
        "Maria to share Figma designs today",
        "Sam to provision AWS infrastructure",
        "Sarah to update stakeholders on timeline"
      ],
      keywords: ["payment", "Stripe", "PayPal", "PCI compliance", "AWS", "MVP"]
    },
    {
      id: "fireflies_002",
      title: "Client Requirements Review",
      date: "2024-06-12",
      duration: "60 min",
      participants: ["John (Sales)", "Enterprise Client", "Sarah (PM)"],
      summary: "Enterprise client outlined custom requirements including SSO, data residency, and SLA guarantees.",
      transcript: `John: Thanks for joining us today. Sarah is our PM who will be taking notes.

Client: We've reviewed your platform and have specific requirements for enterprise deployment.

Sarah: Please go ahead, I'll make sure everything is captured.

Client: First, we need Single Sign-On with Okta. Our employees shouldn't need separate credentials.

Sarah: Understood. We support SAML 2.0 which works with Okta.

Client: Good. Second, all data must reside in EU due to GDPR. We can't have data leaving European borders.

John: We have AWS Frankfurt region available for EU customers.

Client: Third, we need a 99.9% uptime SLA with financial penalties for violations.

Sarah: We can commit to that with our current architecture.

Client: Finally, dedicated support - not shared support queue. We need 4-hour response time for critical issues.

John: We offer premium support tiers that include dedicated account managers.

Client: Budget is $150K annually. Can you work with that?

John: Let me discuss with our team and get back to you by Friday.`,
      actionItems: [
        "Confirm SAML 2.0 compatibility with Okta",
        "Verify EU data residency capabilities",
        "Draft SLA agreement with 99.9% uptime",
        "Prepare premium support proposal"
      ],
      keywords: ["SSO", "Okta", "GDPR", "EU data residency", "SLA", "enterprise"]
    }
  ];
}

// ============================================
// LIVE DATA FETCHERS (when OAuth is enabled)
// ============================================
async function fetchLiveGmailData(accessToken: string) {
  // Real Gmail API implementation
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10",
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );
  
  if (!response.ok) {
    throw new Error(`Gmail API error: ${response.status}`);
  }
  
  return await response.json();
}

async function fetchLiveSlackData(accessToken: string) {
  // Real Slack API implementation
  const response = await fetch(
    "https://slack.com/api/conversations.history",
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );
  
  if (!response.ok) {
    throw new Error(`Slack API error: ${response.status}`);
  }
  
  return await response.json();
}

async function fetchLiveFirefliesData(apiKey: string) {
  // Real Fireflies GraphQL API implementation
  const response = await fetch("https://api.fireflies.ai/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      query: `
        query {
          transcripts {
            id
            title
            date
            duration
            participants
            summary
          }
        }
      `
    })
  });
  
  if (!response.ok) {
    throw new Error(`Fireflies API error: ${response.status}`);
  }
  
  return await response.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const path = url.pathname.split("/").pop();
    
    // Get user from auth header
    const authHeader = req.headers.get("authorization");
    let userId: string | null = null;
    
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id || null;
    }

    console.log(`Integration request: ${path}, userId: ${userId}`);

    // Route: GET /integrations/status
    if (path === "status" || path === "integrations") {
      const { data: accounts } = userId ? await supabase
        .from("integration_accounts")
        .select("*")
        .eq("user_id", userId) : { data: [] };

      const accountMap = new Map(accounts?.map(a => [a.provider, a]) || []);

      const status = {
        gmail: {
          provider: "gmail",
          name: "Gmail",
          description: "Import emails from Gmail inbox",
          oauthReady: true,
          liveEnabled: INTEGRATION_CONFIG.gmail.enabled,
          connected: accountMap.has("gmail") && accountMap.get("gmail")?.is_active,
          mockAvailable: true,
          scopes: INTEGRATION_CONFIG.gmail.scopes,
          accountEmail: accountMap.get("gmail")?.account_email || null
        },
        slack: {
          provider: "slack",
          name: "Slack",
          description: "Import messages from Slack channels",
          oauthReady: true,
          liveEnabled: INTEGRATION_CONFIG.slack.enabled,
          connected: accountMap.has("slack") && accountMap.get("slack")?.is_active,
          mockAvailable: true,
          scopes: INTEGRATION_CONFIG.slack.scopes,
          workspaceName: accountMap.get("slack")?.metadata?.workspace_name || null
        },
        fireflies: {
          provider: "fireflies",
          name: "Fireflies.ai",
          description: "Import meeting transcripts",
          oauthReady: false,
          liveEnabled: INTEGRATION_CONFIG.fireflies.enabled,
          connected: INTEGRATION_CONFIG.fireflies.enabled,
          mockAvailable: true,
          uploadSupported: true
        }
      };

      return new Response(
        JSON.stringify({ success: true, integrations: status }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Route: GET /integrations/oauth-url/:provider
    if (path === "oauth-url") {
      const { provider } = await req.json();
      const config = INTEGRATION_CONFIG[provider as keyof typeof INTEGRATION_CONFIG];
      
      if (!config || !("authUrl" in config)) {
        return new Response(
          JSON.stringify({ error: "Invalid provider or OAuth not supported" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!config.enabled || !config.clientId) {
        return new Response(
          JSON.stringify({
            enabled: false,
            message: `${provider} OAuth not configured. Add ${provider.toUpperCase()}_CLIENT_ID and ${provider.toUpperCase()}_CLIENT_SECRET to enable.`,
            requiredEnvVars: [
              `${provider.toUpperCase()}_CLIENT_ID`,
              `${provider.toUpperCase()}_CLIENT_SECRET`,
              `${provider.toUpperCase()}_OAUTH_ENABLED`
            ],
            scopes: config.scopes
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Generate real OAuth URL when credentials are configured
      const state = crypto.randomUUID();
      const oauthUrl = new URL(config.authUrl);
      oauthUrl.searchParams.set("client_id", config.clientId);
      oauthUrl.searchParams.set("redirect_uri", config.redirectUri);
      oauthUrl.searchParams.set("scope", config.scopes.join(" "));
      oauthUrl.searchParams.set("response_type", "code");
      oauthUrl.searchParams.set("state", state);
      oauthUrl.searchParams.set("access_type", "offline");
      oauthUrl.searchParams.set("prompt", "consent");

      return new Response(
        JSON.stringify({ 
          enabled: true, 
          oauthUrl: oauthUrl.toString(),
          state 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Route: POST /integrations/data
    if (path === "data") {
      const { provider, useMock = true } = await req.json();

      let data;
      let isMock = useMock;

      if (provider === "gmail") {
        if (INTEGRATION_CONFIG.gmail.enabled && !useMock) {
          // Fetch live data using stored token
          const { data: account } = userId ? await supabase
            .from("integration_accounts")
            .select("access_token")
            .eq("user_id", userId)
            .eq("provider", "gmail")
            .single() : { data: null };
          
          if (account?.access_token) {
            data = await fetchLiveGmailData(account.access_token);
            isMock = false;
          } else {
            data = getMockGmailData();
          }
        } else {
          data = getMockGmailData();
        }
      } else if (provider === "slack") {
        if (INTEGRATION_CONFIG.slack.enabled && !useMock) {
          const { data: account } = userId ? await supabase
            .from("integration_accounts")
            .select("access_token")
            .eq("user_id", userId)
            .eq("provider", "slack")
            .single() : { data: null };
          
          if (account?.access_token) {
            data = await fetchLiveSlackData(account.access_token);
            isMock = false;
          } else {
            data = getMockSlackData();
          }
        } else {
          data = getMockSlackData();
        }
      } else if (provider === "fireflies") {
        if (INTEGRATION_CONFIG.fireflies.enabled && !useMock) {
          data = await fetchLiveFirefliesData(INTEGRATION_CONFIG.fireflies.apiKey!);
          isMock = false;
        } else {
          data = getMockFirefliesData();
        }
      } else {
        return new Response(
          JSON.stringify({ error: "Invalid provider" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`Returning ${provider} data (mock: ${isMock}), items: ${Array.isArray(data) ? data.length : 'N/A'}`);

      return new Response(
        JSON.stringify({
          success: true,
          provider,
          mock: isMock,
          count: Array.isArray(data) ? data.length : 0,
          data
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Route: POST /integrations/disconnect
    if (path === "disconnect") {
      if (!userId) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { provider } = await req.json();
      
      const { error } = await supabase
        .from("integration_accounts")
        .delete()
        .eq("user_id", userId)
        .eq("provider", provider);

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true, message: `${provider} disconnected` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Integration error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});