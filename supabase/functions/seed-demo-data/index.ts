import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user.id;
    console.log("Seeding demo data for user:", userId);

    // ========== 1. PROJECTS ==========
    const projectsToInsert = [
      {
        name: "FinTech Mobile App",
        description: "Next-generation mobile banking application with AI-powered financial insights, biometric authentication, and real-time transaction monitoring.",
        owner_id: userId,
      },
      {
        name: "Healthcare Data Platform",
        description: "HIPAA-compliant data analytics platform for hospital networks, enabling predictive patient outcomes and resource optimization.",
        owner_id: userId,
      },
      {
        name: "E-Commerce Redesign",
        description: "Complete overhaul of the customer-facing storefront with personalized recommendations, AR product previews, and streamlined checkout.",
        owner_id: userId,
      },
    ];

    const { data: projects, error: projError } = await supabase
      .from("projects")
      .insert(projectsToInsert)
      .select();

    if (projError) {
      console.error("Project insert error:", projError);
      throw projError;
    }

    console.log("Created projects:", projects.length);

    // Add user as project member
    const memberInserts = projects.map((p: any) => ({
      project_id: p.id,
      user_id: userId,
      role: "admin",
    }));
    await supabase.from("project_members").insert(memberInserts);

    // ========== 2. BRDs ==========
    const brdsToInsert = [
      {
        project_id: projects[0].id,
        created_by: userId,
        title: "FinTech Mobile App — Business Requirements Document",
        status: "approved",
        version: 3,
        executive_summary: "This document outlines the business requirements for a next-generation mobile banking application targeting millennials and Gen-Z users. The app will combine traditional banking features with AI-powered financial wellness tools, crypto portfolio tracking, and social payment features to capture 15% market share within 18 months of launch.",
        business_objectives: [
          { id: "BO-1", text: "Acquire 500,000 active users within the first 12 months post-launch", source: "Stakeholder Meeting - CEO" },
          { id: "BO-2", text: "Reduce customer support costs by 40% through in-app AI assistant", source: "Email Thread - VP Operations" },
          { id: "BO-3", text: "Achieve a 4.5+ App Store rating within 6 months", source: "Product Strategy Deck" },
          { id: "BO-4", text: "Generate $2M ARR from premium subscription tier by Q4 2026", source: "Revenue Planning Meeting" },
        ],
        functional_requirements: [
          { id: "FR-1", text: "Users shall authenticate using biometric (Face ID / fingerprint) and 2FA", priority: "critical", source: "Security Audit Report" },
          { id: "FR-2", text: "The system shall provide real-time transaction notifications with categorization", priority: "high", source: "User Research Interviews" },
          { id: "FR-3", text: "Users shall be able to send peer-to-peer payments via QR code or phone number", priority: "high", source: "Competitor Analysis - Venmo/Zelle" },
          { id: "FR-4", text: "The AI assistant shall provide personalized spending insights and budget recommendations", priority: "medium", source: "Slack Discussion - Product Team" },
          { id: "FR-5", text: "Users shall be able to view and manage crypto portfolio alongside traditional accounts", priority: "medium", source: "Market Research Report" },
          { id: "FR-6", text: "The system shall support scheduled and recurring payments with smart reminders", priority: "high", source: "Fireflies Meeting Transcript - Sprint Planning" },
          { id: "FR-7", text: "Users shall be able to export financial data in CSV, PDF, and OFX formats", priority: "low", source: "Customer Support Tickets Analysis" },
        ],
        non_functional_requirements: [
          { id: "NFR-1", text: "The app shall load within 2 seconds on 4G networks", priority: "critical", source: "Performance Requirements Doc" },
          { id: "NFR-2", text: "System shall maintain 99.95% uptime SLA", priority: "critical", source: "SLA Agreement Draft" },
          { id: "NFR-3", text: "All financial data shall be encrypted at rest (AES-256) and in transit (TLS 1.3)", priority: "critical", source: "Security Compliance Team" },
          { id: "NFR-4", text: "The system shall support 100,000 concurrent users without degradation", priority: "high", source: "Load Testing Requirements" },
          { id: "NFR-5", text: "App shall comply with PCI-DSS Level 1 and SOC 2 Type II", priority: "critical", source: "Compliance Team Email" },
        ],
        stakeholder_analysis: [
          { name: "Sarah Chen", role: "CEO", influence: "high", interest: "Revenue growth and market penetration", sentiment: "supportive" },
          { name: "James Rodriguez", role: "CTO", influence: "high", interest: "Technical architecture and scalability", sentiment: "cautiously optimistic" },
          { name: "Priya Patel", role: "VP Product", influence: "high", interest: "User experience and feature parity", sentiment: "enthusiastic" },
          { name: "Michael Okafor", role: "Head of Compliance", influence: "medium", interest: "Regulatory compliance and data privacy", sentiment: "concerned about timeline" },
        ],
        assumptions: [
          "Banking API partner (Plaid) will provide sandbox access by Q1 2026",
          "Design system will be finalized before development sprint 1",
          "Third-party crypto API (CoinGecko) will remain available and free-tier sufficient for MVP",
          "Apple and Google app store review processes will take 2-4 weeks",
        ],
        success_metrics: [
          { metric: "Monthly Active Users", target: "500K", timeline: "12 months" },
          { metric: "App Store Rating", target: "4.5+", timeline: "6 months" },
          { metric: "Customer Support Ticket Reduction", target: "40%", timeline: "6 months" },
          { metric: "Premium Subscription Conversion", target: "8%", timeline: "12 months" },
        ],
        timeline: {
          phases: [
            { name: "Discovery & Design", duration: "6 weeks", start: "2026-01-15" },
            { name: "Core Development (Sprint 1-4)", duration: "8 weeks", start: "2026-03-01" },
            { name: "Integration & Testing", duration: "4 weeks", start: "2026-04-26" },
            { name: "Beta Launch", duration: "3 weeks", start: "2026-05-24" },
            { name: "GA Release", duration: "2 weeks", start: "2026-06-14" },
          ],
        },
        raw_sources: [
          { type: "gmail", subject: "RE: Mobile App Revenue Projections", from: "sarah.chen@company.com", date: "2025-12-15" },
          { type: "slack", channel: "#product-mobile-app", message_count: 47, date_range: "2025-12-01 to 2026-01-10" },
          { type: "fireflies", meeting: "Sprint Planning - Mobile App Kickoff", duration: "45 min", date: "2026-01-08" },
          { type: "document", name: "Market_Research_Q4_2025.pdf", pages: 28 },
        ],
      },
      {
        project_id: projects[1].id,
        created_by: userId,
        title: "Healthcare Data Platform — Requirements Specification",
        status: "in_review",
        version: 2,
        executive_summary: "A cloud-native analytics platform enabling hospital networks to aggregate patient data, predict outcomes using machine learning, and optimize resource allocation. The platform must comply with HIPAA, HL7 FHIR, and support integration with existing EHR systems.",
        business_objectives: [
          { id: "BO-1", text: "Reduce average patient wait time by 25% through predictive scheduling", source: "Hospital Admin Interviews" },
          { id: "BO-2", text: "Achieve HITRUST CSF certification within 12 months", source: "Compliance Meeting Notes" },
          { id: "BO-3", text: "Onboard 5 hospital networks within the first year", source: "Sales Strategy Document" },
        ],
        functional_requirements: [
          { id: "FR-1", text: "System shall ingest data from Epic, Cerner, and Allscripts EHR systems via HL7 FHIR APIs", priority: "critical", source: "Technical Architecture Review" },
          { id: "FR-2", text: "Dashboard shall display real-time bed occupancy, staff allocation, and patient flow metrics", priority: "high", source: "Hospital CIO Requirements" },
          { id: "FR-3", text: "ML models shall predict patient readmission risk with >85% accuracy", priority: "high", source: "Clinical Advisory Board" },
          { id: "FR-4", text: "System shall generate automated compliance audit reports", priority: "medium", source: "Compliance Team" },
          { id: "FR-5", text: "Alerts shall notify staff when critical patient metrics exceed thresholds", priority: "critical", source: "Nursing Staff Feedback" },
        ],
        non_functional_requirements: [
          { id: "NFR-1", text: "All PHI must be encrypted using FIPS 140-2 validated cryptography", priority: "critical", source: "HIPAA Security Rule" },
          { id: "NFR-2", text: "System shall maintain complete audit trail of all data access", priority: "critical", source: "HIPAA Audit Requirements" },
          { id: "NFR-3", text: "Dashboard shall render within 3 seconds for datasets up to 10M records", priority: "high", source: "Performance SLA" },
        ],
        stakeholder_analysis: [
          { name: "Dr. Lisa Wong", role: "Chief Medical Officer", influence: "high", interest: "Clinical accuracy and patient outcomes", sentiment: "supportive" },
          { name: "Robert Kim", role: "Hospital CIO", influence: "high", interest: "System integration and data security", sentiment: "cautious" },
        ],
        assumptions: [
          "Partner hospitals will provide de-identified training data for ML models",
          "HL7 FHIR R4 will remain the standard interface for EHR integration",
        ],
        success_metrics: [
          { metric: "Patient Wait Time Reduction", target: "25%", timeline: "6 months post-deployment" },
          { metric: "Prediction Accuracy", target: ">85%", timeline: "After 3 months training" },
        ],
        timeline: {
          phases: [
            { name: "Architecture & Compliance Planning", duration: "8 weeks", start: "2026-02-01" },
            { name: "Core Platform Development", duration: "12 weeks", start: "2026-03-28" },
            { name: "ML Model Training", duration: "6 weeks", start: "2026-06-20" },
            { name: "Pilot Deployment", duration: "4 weeks", start: "2026-08-01" },
          ],
        },
        raw_sources: [
          { type: "gmail", subject: "HIPAA Compliance Checklist Review", from: "compliance@healthco.com", date: "2026-01-20" },
          { type: "fireflies", meeting: "Clinical Advisory Board - Data Platform Requirements", duration: "60 min", date: "2026-01-25" },
          { type: "document", name: "EHR_Integration_Specifications.pdf", pages: 42 },
        ],
      },
      {
        project_id: projects[2].id,
        created_by: userId,
        title: "E-Commerce Redesign — Business Requirements",
        status: "draft",
        version: 1,
        executive_summary: "Complete redesign of the customer-facing e-commerce platform to improve conversion rates, reduce cart abandonment, and introduce AR-powered product previews. Target: 30% increase in conversion rate within 6 months of launch.",
        business_objectives: [
          { id: "BO-1", text: "Increase conversion rate from 2.1% to 2.7% (30% improvement)", source: "Analytics Dashboard Review" },
          { id: "BO-2", text: "Reduce cart abandonment from 68% to 50%", source: "Customer Journey Analysis" },
          { id: "BO-3", text: "Achieve <2s page load time across all product pages", source: "Performance Audit" },
        ],
        functional_requirements: [
          { id: "FR-1", text: "Product pages shall include AR preview functionality for supported devices", priority: "high", source: "Innovation Team Proposal" },
          { id: "FR-2", text: "Checkout shall support one-click purchase for returning customers", priority: "critical", source: "UX Research Findings" },
          { id: "FR-3", text: "Recommendation engine shall display personalized suggestions based on browsing and purchase history", priority: "high", source: "Data Science Team" },
          { id: "FR-4", text: "Search shall support natural language queries and visual search", priority: "medium", source: "Competitor Analysis" },
        ],
        non_functional_requirements: [
          { id: "NFR-1", text: "Pages shall achieve Lighthouse performance score >90", priority: "high", source: "SEO Team" },
          { id: "NFR-2", text: "System shall handle 50,000 concurrent users during flash sales", priority: "critical", source: "Black Friday Post-Mortem" },
        ],
        stakeholder_analysis: [
          { name: "Emma Zhang", role: "VP E-Commerce", influence: "high", interest: "Revenue and conversion metrics", sentiment: "enthusiastic" },
          { name: "David Park", role: "UX Director", influence: "high", interest: "User experience and accessibility", sentiment: "supportive" },
        ],
        assumptions: [
          "WebXR API will be stable enough for production AR features by launch",
          "Existing product catalog data is sufficient for recommendation engine training",
        ],
        success_metrics: [
          { metric: "Conversion Rate", target: "2.7%+", timeline: "6 months" },
          { metric: "Cart Abandonment", target: "<50%", timeline: "3 months" },
          { metric: "Page Load Time", target: "<2s", timeline: "At launch" },
        ],
        timeline: {
          phases: [
            { name: "UX Research & Design", duration: "6 weeks", start: "2026-03-01" },
            { name: "Frontend Development", duration: "10 weeks", start: "2026-04-12" },
            { name: "AR Feature Development", duration: "6 weeks", start: "2026-05-10" },
            { name: "A/B Testing & Optimization", duration: "4 weeks", start: "2026-06-21" },
          ],
        },
        raw_sources: [
          { type: "slack", channel: "#ecommerce-redesign", message_count: 112, date_range: "2026-01-01 to 2026-02-05" },
          { type: "document", name: "UX_Research_Findings_2025.pdf", pages: 36 },
          { type: "gmail", subject: "Black Friday Performance Post-Mortem", from: "infra@company.com", date: "2025-12-02" },
        ],
      },
    ];

    const { data: brds, error: brdError } = await supabase
      .from("brds")
      .insert(brdsToInsert)
      .select();

    if (brdError) {
      console.error("BRD insert error:", brdError);
      throw brdError;
    }

    console.log("Created BRDs:", brds.length);

    // ========== 3. TASKS ==========
    const now = new Date();
    const daysFromNow = (d: number) => new Date(now.getTime() + d * 86400000).toISOString();
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000).toISOString();

    const tasksToInsert = [
      // FinTech project tasks (diverse statuses)
      { project_id: projects[0].id, brd_id: brds[0].id, created_by: userId, title: "Design biometric authentication flow", description: "Create UX wireframes and user flows for Face ID and fingerprint authentication, including fallback PIN entry.", status: "done", priority: "critical", requirement_id: "FR-1", estimated_hours: 16, actual_hours: 14, deadline: daysAgo(5), completed_at: daysAgo(3), delay_risk_score: 0.05 },
      { project_id: projects[0].id, brd_id: brds[0].id, created_by: userId, title: "Implement 2FA with TOTP and SMS", description: "Build two-factor authentication system supporting both TOTP (Google Authenticator) and SMS verification codes.", status: "done", priority: "critical", requirement_id: "FR-1", estimated_hours: 24, actual_hours: 28, deadline: daysAgo(2), completed_at: daysAgo(1), delay_risk_score: 0.1 },
      { project_id: projects[0].id, brd_id: brds[0].id, created_by: userId, title: "Build real-time transaction notification service", description: "Implement WebSocket-based notification system for instant transaction alerts with smart categorization using ML.", status: "in_progress", priority: "high", requirement_id: "FR-2", estimated_hours: 32, actual_hours: 18, deadline: daysFromNow(5), delay_risk_score: 0.35 },
      { project_id: projects[0].id, brd_id: brds[0].id, created_by: userId, title: "Develop P2P payment QR code system", description: "Build QR code generation and scanning for peer-to-peer payments, integrating with payment processing backend.", status: "in_progress", priority: "high", requirement_id: "FR-3", estimated_hours: 24, actual_hours: 10, deadline: daysFromNow(8), delay_risk_score: 0.45 },
      { project_id: projects[0].id, brd_id: brds[0].id, created_by: userId, title: "Integrate AI spending insights engine", description: "Connect to ML model endpoint for personalized budget analysis and spending pattern recommendations.", status: "todo", priority: "medium", requirement_id: "FR-4", estimated_hours: 40, deadline: daysFromNow(18), delay_risk_score: 0.55 },
      { project_id: projects[0].id, brd_id: brds[0].id, created_by: userId, title: "Build crypto portfolio dashboard", description: "Integrate CoinGecko API for real-time crypto prices and build portfolio tracking UI alongside traditional accounts.", status: "backlog", priority: "medium", requirement_id: "FR-5", estimated_hours: 32, deadline: daysFromNow(25), delay_risk_score: 0.3 },
      { project_id: projects[0].id, brd_id: brds[0].id, created_by: userId, title: "Implement recurring payments scheduler", description: "Build smart scheduling system for recurring payments with intelligent reminders and conflict detection.", status: "in_review", priority: "high", requirement_id: "FR-6", estimated_hours: 20, actual_hours: 22, deadline: daysFromNow(2), delay_risk_score: 0.15 },
      { project_id: projects[0].id, brd_id: brds[0].id, created_by: userId, title: "Performance optimization — sub-2s load time", description: "Optimize app bundle size, implement code splitting, and configure CDN for achieving <2s load on 4G networks.", status: "todo", priority: "critical", requirement_id: "NFR-1", estimated_hours: 24, deadline: daysFromNow(12), delay_risk_score: 0.7 },
      { project_id: projects[0].id, brd_id: brds[0].id, created_by: userId, title: "PCI-DSS Level 1 compliance audit prep", description: "Prepare documentation, configure security controls, and run vulnerability scans for PCI-DSS certification.", status: "blocked", priority: "critical", requirement_id: "NFR-5", estimated_hours: 40, deadline: daysFromNow(20), delay_risk_score: 0.82 },
      { project_id: projects[0].id, brd_id: brds[0].id, created_by: userId, title: "Financial data export module (CSV/PDF/OFX)", description: "Build data export pipeline supporting multiple formats with proper formatting and transaction categorization.", status: "backlog", priority: "low", requirement_id: "FR-7", estimated_hours: 16, deadline: daysFromNow(30), delay_risk_score: 0.15 },

      // Healthcare project tasks
      { project_id: projects[1].id, brd_id: brds[1].id, created_by: userId, title: "Design FHIR API integration layer", description: "Architect the HL7 FHIR R4 integration layer for connecting with Epic, Cerner, and Allscripts EHR systems.", status: "in_progress", priority: "critical", requirement_id: "FR-1", estimated_hours: 48, actual_hours: 20, deadline: daysFromNow(14), delay_risk_score: 0.4 },
      { project_id: projects[1].id, brd_id: brds[1].id, created_by: userId, title: "Build real-time hospital dashboard", description: "Create dashboard showing live bed occupancy, staff allocation, and patient flow metrics with auto-refresh.", status: "todo", priority: "high", requirement_id: "FR-2", estimated_hours: 36, deadline: daysFromNow(21), delay_risk_score: 0.5 },
      { project_id: projects[1].id, brd_id: brds[1].id, created_by: userId, title: "Train readmission prediction ML model", description: "Develop and train machine learning model for predicting patient readmission risk, targeting >85% accuracy.", status: "backlog", priority: "high", requirement_id: "FR-3", estimated_hours: 60, deadline: daysFromNow(45), delay_risk_score: 0.65 },
      { project_id: projects[1].id, brd_id: brds[1].id, created_by: userId, title: "Implement HIPAA audit trail system", description: "Build comprehensive audit logging for all PHI data access with tamper-proof storage and reporting.", status: "in_progress", priority: "critical", requirement_id: "NFR-2", estimated_hours: 32, actual_hours: 15, deadline: daysFromNow(10), delay_risk_score: 0.3 },
      { project_id: projects[1].id, brd_id: brds[1].id, created_by: userId, title: "Configure FIPS 140-2 encryption", description: "Implement FIPS 140-2 validated encryption for all PHI data at rest and in transit.", status: "done", priority: "critical", requirement_id: "NFR-1", estimated_hours: 20, actual_hours: 18, deadline: daysAgo(3), completed_at: daysAgo(1), delay_risk_score: 0.0 },
      { project_id: projects[1].id, brd_id: brds[1].id, created_by: userId, title: "Build critical patient alert system", description: "Implement threshold-based alerting for critical patient metrics with escalation workflows.", status: "todo", priority: "critical", requirement_id: "FR-5", estimated_hours: 28, deadline: daysFromNow(16), delay_risk_score: 0.45 },

      // E-Commerce project tasks
      { project_id: projects[2].id, brd_id: brds[2].id, created_by: userId, title: "Prototype AR product preview with WebXR", description: "Build proof-of-concept AR product viewer using WebXR API for supported mobile devices.", status: "in_progress", priority: "high", requirement_id: "FR-1", estimated_hours: 40, actual_hours: 12, deadline: daysFromNow(15), delay_risk_score: 0.6 },
      { project_id: projects[2].id, brd_id: brds[2].id, created_by: userId, title: "Implement one-click checkout flow", description: "Build streamlined checkout for returning customers with saved payment methods and address auto-fill.", status: "todo", priority: "critical", requirement_id: "FR-2", estimated_hours: 20, deadline: daysFromNow(10), delay_risk_score: 0.25 },
      { project_id: projects[2].id, brd_id: brds[2].id, created_by: userId, title: "Build ML recommendation engine", description: "Develop personalized product recommendation system using collaborative filtering and browsing history analysis.", status: "backlog", priority: "high", requirement_id: "FR-3", estimated_hours: 48, deadline: daysFromNow(28), delay_risk_score: 0.55 },
      { project_id: projects[2].id, brd_id: brds[2].id, created_by: userId, title: "Implement natural language search", description: "Add NLP-powered search supporting conversational queries like 'red dress under $50 for summer wedding'.", status: "backlog", priority: "medium", requirement_id: "FR-4", estimated_hours: 36, deadline: daysFromNow(35), delay_risk_score: 0.4 },
      { project_id: projects[2].id, brd_id: brds[2].id, created_by: userId, title: "Lighthouse performance optimization sprint", description: "Optimize Core Web Vitals and achieve Lighthouse performance score >90 across all product pages.", status: "todo", priority: "high", requirement_id: "NFR-1", estimated_hours: 24, deadline: daysFromNow(12), delay_risk_score: 0.35 },
      { project_id: projects[2].id, brd_id: brds[2].id, created_by: userId, title: "Load testing for flash sale capacity", description: "Configure and run load tests simulating 50K concurrent users, identify bottlenecks and optimize.", status: "backlog", priority: "critical", requirement_id: "NFR-2", estimated_hours: 20, deadline: daysFromNow(22), delay_risk_score: 0.5 },
    ];

    const { data: tasks, error: taskError } = await supabase
      .from("tasks")
      .insert(tasksToInsert)
      .select();

    if (taskError) {
      console.error("Task insert error:", taskError);
      throw taskError;
    }

    console.log("Created tasks:", tasks.length);

    // ========== 4. TASK DEPENDENCIES ==========
    // Map tasks by title for easy lookup
    const taskMap = new Map<string, string>();
    tasks.forEach((t: any) => taskMap.set(t.title, t.id));

    const dependenciesToInsert = [
      { task_id: taskMap.get("Implement 2FA with TOTP and SMS")!, depends_on_id: taskMap.get("Design biometric authentication flow")! },
      { task_id: taskMap.get("Develop P2P payment QR code system")!, depends_on_id: taskMap.get("Implement 2FA with TOTP and SMS")! },
      { task_id: taskMap.get("Integrate AI spending insights engine")!, depends_on_id: taskMap.get("Build real-time transaction notification service")! },
      { task_id: taskMap.get("Performance optimization — sub-2s load time")!, depends_on_id: taskMap.get("Build crypto portfolio dashboard")! },
      { task_id: taskMap.get("Build real-time hospital dashboard")!, depends_on_id: taskMap.get("Design FHIR API integration layer")! },
      { task_id: taskMap.get("Train readmission prediction ML model")!, depends_on_id: taskMap.get("Design FHIR API integration layer")! },
      { task_id: taskMap.get("Implement one-click checkout flow")!, depends_on_id: taskMap.get("Prototype AR product preview with WebXR")! },
      { task_id: taskMap.get("Build ML recommendation engine")!, depends_on_id: taskMap.get("Implement one-click checkout flow")! },
    ].filter(d => d.task_id && d.depends_on_id);

    if (dependenciesToInsert.length > 0) {
      await supabase.from("task_dependencies").insert(dependenciesToInsert);
      console.log("Created dependencies:", dependenciesToInsert.length);
    }

    // ========== 5. PREDICTIONS ==========
    const highRiskTasks = tasks.filter((t: any) => (t.delay_risk_score || 0) > 0.4);
    const predictionsToInsert = highRiskTasks.map((t: any) => {
      const riskLevel = t.delay_risk_score > 0.7 ? "high" : t.delay_risk_score > 0.5 ? "medium" : "low";
      const reasonings: Record<string, string> = {
        high: "Task has significant dependency depth and estimated hours exceed team velocity. Historical data shows similar tasks frequently miss deadlines.",
        medium: "Moderate complexity with some dependency risks. Team capacity may be stretched if concurrent tasks aren't reprioritized.",
        low: "Slight risk due to external dependencies. Manageable with proactive coordination.",
      };
      return {
        task_id: t.id,
        prediction_type: "delay",
        risk_level: riskLevel,
        probability: t.delay_risk_score,
        reasoning: reasonings[riskLevel],
      };
    });

    if (predictionsToInsert.length > 0) {
      await supabase.from("predictions").insert(predictionsToInsert);
      console.log("Created predictions:", predictionsToInsert.length);
    }

    // ========== 6. WORKLOAD ANALYTICS ==========
    const workloadToInsert = projects.map((p: any) => ({
      project_id: p.id,
      user_id: userId,
      period_start: daysAgo(30),
      period_end: now.toISOString(),
      assigned_tasks: Math.floor(Math.random() * 8) + 4,
      completed_tasks: Math.floor(Math.random() * 5) + 1,
      overdue_tasks: Math.floor(Math.random() * 3),
      avg_completion_time_hours: Math.round((Math.random() * 20 + 10) * 10) / 10,
      workload_score: Math.round((Math.random() * 40 + 50) * 10) / 10,
    }));

    await supabase.from("workload_analytics").insert(workloadToInsert);
    console.log("Created workload analytics:", workloadToInsert.length);

    // ========== 7. BRD VERSIONS ==========
    const versionsToInsert = [
      {
        brd_id: brds[0].id,
        version: 1,
        edited_by: userId,
        edit_note: "Initial BRD draft generated from Gmail threads and Slack discussions",
        content: { status: "draft", sections_completed: 5 },
        created_at: daysAgo(14),
      },
      {
        brd_id: brds[0].id,
        version: 2,
        edited_by: userId,
        edit_note: "Added crypto portfolio requirements and updated security compliance section per stakeholder feedback",
        content: { status: "in_review", sections_completed: 7 },
        created_at: daysAgo(7),
      },
      {
        brd_id: brds[0].id,
        version: 3,
        edited_by: userId,
        edit_note: "Final approval — all stakeholder comments addressed, compliance requirements verified",
        content: { status: "approved", sections_completed: 7 },
        created_at: daysAgo(2),
      },
    ];

    await supabase.from("brd_versions").insert(versionsToInsert);
    console.log("Created BRD versions:", versionsToInsert.length);

    return new Response(
      JSON.stringify({
        success: true,
        summary: {
          projects: projects.length,
          brds: brds.length,
          tasks: tasks.length,
          dependencies: dependenciesToInsert.length,
          predictions: predictionsToInsert.length,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error seeding demo data:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});