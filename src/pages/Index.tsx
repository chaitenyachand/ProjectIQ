import { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { 
  Zap, 
  FileText, 
  ListTodo, 
  BarChart3, 
  ArrowRight,
  Sparkles,
  Brain,
  Target,
  TrendingUp
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';

export default function Index() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user) {
      navigate('/dashboard');
    }
  }, [user, loading, navigate]);

  const features = [
    {
      icon: FileText,
      title: 'BRD Intelligence',
      description: 'Transform messy notes, emails, and documents into structured Business Requirements Documents with AI.',
    },
    {
      icon: ListTodo,
      title: 'Smart Task Execution',
      description: 'Automatically convert requirements into actionable tasks with dependencies and priorities.',
    },
    {
      icon: Brain,
      title: 'ML Predictions',
      description: 'Predict delays, identify bottlenecks, and detect overloaded team members before issues arise.',
    },
    {
      icon: BarChart3,
      title: 'Actionable Analytics',
      description: 'Real-time insights and recommendations to keep your projects on track.',
    },
  ];

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-primary/5 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-info/5 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-6xl mx-auto px-4 py-20 sm:px-6 lg:px-8 lg:py-32">
          {/* Header */}
          <header className="flex items-center justify-between mb-20">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 border border-primary/20">
                <Zap className="w-5 h-5 text-primary" />
              </div>
              <span className="text-xl font-semibold">ProjectIQ</span>
            </div>
            <div className="flex items-center gap-4">
              <Button variant="ghost" asChild>
                <Link to="/auth">Sign In</Link>
              </Button>
              <Button asChild>
                <Link to="/auth">Get Started</Link>
              </Button>
            </div>
          </header>

          {/* Hero content */}
          <div className="text-center space-y-8 animate-fade-in">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-sm">
              <Sparkles className="w-4 h-4 text-primary" />
              <span>AI-Powered Project Intelligence</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight max-w-4xl mx-auto">
              From{' '}
              <span className="gradient-text">Messy Requirements</span>
              {' '}to{' '}
              <span className="gradient-text">Intelligent Execution</span>
            </h1>

            <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto">
              Transform unstructured inputs into structured BRDs, executable tasks, 
              and predictive insights. Built for teams who ship faster.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button size="lg" asChild className="gap-2">
                <Link to="/auth">
                  Start Building
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="/auth">View Demo</Link>
              </Button>
            </div>
          </div>

          {/* Feature highlights */}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mt-24">
            {features.map((feature, index) => (
              <div 
                key={feature.title}
                className="p-6 rounded-xl bg-card/50 border border-border/50 backdrop-blur-sm card-interactive animate-fade-in"
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <div className="p-3 rounded-lg bg-primary/10 w-fit mb-4">
                  <feature.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </div>
            ))}
          </div>

          {/* Process visualization */}
          <div className="mt-32 text-center">
            <h2 className="text-2xl sm:text-3xl font-bold mb-4">
              The Complete Intelligence Pipeline
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto mb-12">
              From chaotic communication to predictive project management
            </p>

            <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-8">
              {[
                { icon: FileText, label: 'Raw Input', sublabel: 'Documents, emails, notes' },
                { icon: Brain, label: 'AI Extraction', sublabel: 'Requirements & structure' },
                { icon: Target, label: 'BRD Generation', sublabel: 'Professional documents' },
                { icon: ListTodo, label: 'Task Breakdown', sublabel: 'Executable work items' },
                { icon: TrendingUp, label: 'Predictions', sublabel: 'ML-powered insights' },
              ].map((step, index, arr) => (
                <div key={step.label} className="flex items-center gap-4 md:gap-8">
                  <div className="flex flex-col items-center">
                    <div className="p-4 rounded-xl bg-card border border-border mb-2">
                      <step.icon className="w-6 h-6 text-primary" />
                    </div>
                    <span className="font-medium text-sm">{step.label}</span>
                    <span className="text-xs text-muted-foreground">{step.sublabel}</span>
                  </div>
                  {index < arr.length - 1 && (
                    <ArrowRight className="w-5 h-5 text-muted-foreground hidden md:block" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* CTA Section */}
          <div className="mt-32 text-center p-8 rounded-2xl bg-gradient-to-br from-primary/10 to-info/10 border border-primary/20">
            <h2 className="text-2xl sm:text-3xl font-bold mb-4">
              Ready to Transform Your Projects?
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto mb-6">
              Join teams using AI to ship faster and smarter. 
              Start with your first BRD in minutes.
            </p>
            <Button size="lg" asChild className="gap-2">
              <Link to="/auth">
                <Sparkles className="w-4 h-4" />
                Get Started Free
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}