-- Create roles enum
CREATE TYPE public.app_role AS ENUM ('admin', 'member');

-- Create profiles table for user data
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create user_roles table (separate from profiles for security)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);

-- Create projects table
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create project_members table
CREATE TABLE public.project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, user_id)
);

-- Create BRD status enum
CREATE TYPE public.brd_status AS ENUM ('draft', 'in_review', 'approved', 'archived');

-- Create brds table
CREATE TABLE public.brds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status brd_status NOT NULL DEFAULT 'draft',
  executive_summary TEXT,
  business_objectives JSONB DEFAULT '[]'::jsonb,
  stakeholder_analysis JSONB DEFAULT '[]'::jsonb,
  functional_requirements JSONB DEFAULT '[]'::jsonb,
  non_functional_requirements JSONB DEFAULT '[]'::jsonb,
  assumptions JSONB DEFAULT '[]'::jsonb,
  success_metrics JSONB DEFAULT '[]'::jsonb,
  timeline JSONB DEFAULT '{}'::jsonb,
  raw_sources JSONB DEFAULT '[]'::jsonb,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create brd_versions table for history
CREATE TABLE public.brd_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brd_id UUID NOT NULL REFERENCES public.brds(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content JSONB NOT NULL,
  edited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  edit_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create task priority enum
CREATE TYPE public.task_priority AS ENUM ('low', 'medium', 'high', 'critical');

-- Create task status enum
CREATE TYPE public.task_status AS ENUM ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked');

-- Create tasks table
CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  brd_id UUID REFERENCES public.brds(id) ON DELETE SET NULL,
  requirement_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status task_status NOT NULL DEFAULT 'backlog',
  priority task_priority NOT NULL DEFAULT 'medium',
  assignee_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deadline TIMESTAMPTZ,
  estimated_hours NUMERIC(6,2),
  actual_hours NUMERIC(6,2),
  delay_risk_score NUMERIC(3,2) DEFAULT 0,
  dependency_depth INTEGER DEFAULT 0,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Create task_dependencies table
CREATE TABLE public.task_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  depends_on_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(task_id, depends_on_id),
  CHECK (task_id != depends_on_id)
);

-- Create task_events table for history
CREATE TABLE public.task_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create document_uploads table
CREATE TABLE public.document_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT false,
  extracted_text TEXT,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create predictions table for ML insights
CREATE TABLE public.predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  prediction_type TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  probability NUMERIC(3,2),
  reasoning TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create workload_analytics table
CREATE TABLE public.workload_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  assigned_tasks INTEGER DEFAULT 0,
  completed_tasks INTEGER DEFAULT 0,
  overdue_tasks INTEGER DEFAULT 0,
  avg_completion_time_hours NUMERIC(6,2),
  workload_score NUMERIC(3,2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brd_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workload_analytics ENABLE ROW LEVEL SECURITY;

-- Security definer function for role checking
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Function to check project membership
CREATE OR REPLACE FUNCTION public.is_project_member(_user_id UUID, _project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members
    WHERE user_id = _user_id AND project_id = _project_id
  ) OR EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = _project_id AND owner_id = _user_id
  )
$$;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- User roles policies
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);

-- Projects policies
CREATE POLICY "Users can view their projects" ON public.projects FOR SELECT 
  USING (owner_id = auth.uid() OR public.is_project_member(auth.uid(), id));
CREATE POLICY "Users can create projects" ON public.projects FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners can update projects" ON public.projects FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Owners can delete projects" ON public.projects FOR DELETE USING (auth.uid() = owner_id);

-- Project members policies
CREATE POLICY "Members can view project members" ON public.project_members FOR SELECT 
  USING (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "Owners can manage project members" ON public.project_members FOR ALL 
  USING (EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND owner_id = auth.uid()));

-- BRDs policies
CREATE POLICY "Project members can view BRDs" ON public.brds FOR SELECT 
  USING (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "Project members can create BRDs" ON public.brds FOR INSERT 
  WITH CHECK (public.is_project_member(auth.uid(), project_id) AND auth.uid() = created_by);
CREATE POLICY "Project members can update BRDs" ON public.brds FOR UPDATE 
  USING (public.is_project_member(auth.uid(), project_id));

-- BRD versions policies
CREATE POLICY "Project members can view BRD versions" ON public.brd_versions FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.brds WHERE id = brd_id AND public.is_project_member(auth.uid(), project_id)));
CREATE POLICY "Project members can create BRD versions" ON public.brd_versions FOR INSERT 
  WITH CHECK (EXISTS (SELECT 1 FROM public.brds WHERE id = brd_id AND public.is_project_member(auth.uid(), project_id)));

-- Tasks policies
CREATE POLICY "Project members can view tasks" ON public.tasks FOR SELECT 
  USING (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "Project members can create tasks" ON public.tasks FOR INSERT 
  WITH CHECK (public.is_project_member(auth.uid(), project_id) AND auth.uid() = created_by);
CREATE POLICY "Project members can update tasks" ON public.tasks FOR UPDATE 
  USING (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "Project members can delete tasks" ON public.tasks FOR DELETE 
  USING (public.is_project_member(auth.uid(), project_id));

-- Task dependencies policies
CREATE POLICY "Project members can view dependencies" ON public.task_dependencies FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.tasks WHERE id = task_id AND public.is_project_member(auth.uid(), project_id)));
CREATE POLICY "Project members can manage dependencies" ON public.task_dependencies FOR ALL 
  USING (EXISTS (SELECT 1 FROM public.tasks WHERE id = task_id AND public.is_project_member(auth.uid(), project_id)));

-- Task events policies
CREATE POLICY "Project members can view task events" ON public.task_events FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.tasks WHERE id = task_id AND public.is_project_member(auth.uid(), project_id)));
CREATE POLICY "Project members can create task events" ON public.task_events FOR INSERT 
  WITH CHECK (EXISTS (SELECT 1 FROM public.tasks WHERE id = task_id AND public.is_project_member(auth.uid(), project_id)));

-- Document uploads policies
CREATE POLICY "Project members can view uploads" ON public.document_uploads FOR SELECT 
  USING (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "Project members can upload documents" ON public.document_uploads FOR INSERT 
  WITH CHECK (public.is_project_member(auth.uid(), project_id) AND auth.uid() = uploaded_by);

-- Predictions policies
CREATE POLICY "Project members can view predictions" ON public.predictions FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.tasks WHERE id = task_id AND public.is_project_member(auth.uid(), project_id)));

-- Workload analytics policies
CREATE POLICY "Users can view own workload analytics" ON public.workload_analytics FOR SELECT 
  USING (user_id = auth.uid() OR public.is_project_member(auth.uid(), project_id));

-- Function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create triggers for updated_at
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_brds_updated_at BEFORE UPDATE ON public.brds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Function to auto-create profile and role on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'member');
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger to create profile on signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to log task events
CREATE OR REPLACE FUNCTION public.log_task_event()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO public.task_events (task_id, event_type, old_value, new_value, user_id)
    VALUES (
      NEW.id,
      'update',
      jsonb_build_object('status', OLD.status, 'priority', OLD.priority, 'assignee_id', OLD.assignee_id, 'deadline', OLD.deadline),
      jsonb_build_object('status', NEW.status, 'priority', NEW.priority, 'assignee_id', NEW.assignee_id, 'deadline', NEW.deadline),
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER task_event_logger
  AFTER UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.log_task_event();

-- Create storage bucket for documents
INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false);

-- Storage policies
CREATE POLICY "Project members can upload documents" ON storage.objects FOR INSERT 
  WITH CHECK (bucket_id = 'documents' AND auth.role() = 'authenticated');
CREATE POLICY "Project members can view documents" ON storage.objects FOR SELECT 
  USING (bucket_id = 'documents' AND auth.role() = 'authenticated');
CREATE POLICY "Project members can delete documents" ON storage.objects FOR DELETE 
  USING (bucket_id = 'documents' AND auth.role() = 'authenticated');