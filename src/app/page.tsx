import Link from "next/link";
import {
  ArrowRight,
  Briefcase,
  CheckCircle2,
  FileText,
  Globe2,
  Lock,
  MailCheck,
  ShieldCheck,
  Sparkles,
  Target,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";

const FEATURES = [
  {
    icon: FileText,
    title: "Bilingual PDF CV Intelligence",
    description:
      "Upload French or English PDF resumes into private encrypted storage and extract verified skills, education, projects, and experience without hallucination.",
  },
  {
    icon: Globe2,
    title: "Morocco, Europe & Remote Discovery",
    description:
      "Search real openings across Casablanca, Rabat, Paris, Europe, and global remote boards via Remotive, Arbeitnow, Adzuna, and official ATS APIs.",
  },
  {
    icon: Target,
    title: "Explainable 0–100% Matching",
    description:
      "Transparent compatibility scoring across technical skills, seniority, sector, location, and language — showing exact matched and missing skills.",
  },
  {
    icon: Sparkles,
    title: "Tailored Emails & PDF Cover Letters",
    description:
      "Automatically detects French or English postings and generates personalized emails plus downloadable A4 PDF cover letters via Groq & Gemini.",
  },
  {
    icon: ShieldCheck,
    title: "Cryptographic Approval Gate",
    description:
      "Mandatory human-in-the-loop approval locks the exact recipient, subject, body, CV, and Cover Letter SHA-256 before any email can be dispatched.",
  },
  {
    icon: MailCheck,
    title: "Connected Gmail OAuth 2.0 & CRM",
    description:
      "Send approved applications with both PDF attachments directly from your Gmail account, prevent duplicate sends, and track interviews to offers.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-sm">
              <Sparkles className="h-5 w-5" />
            </div>
            <span className="font-bold tracking-tight text-lg">
              AI JOB HUNTER
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" asChild>
              <Link href="/login">Log In</Link>
            </Button>
            <Button asChild>
              <Link href="/register">
                Get Started Free
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden py-20 sm:py-28">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(59,130,246,0.14),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(124,58,237,0.12),transparent_50%)]" />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6">
          <Badge className="px-3.5 py-1 text-xs">
            Cloud-Native SaaS • Groq + Gemini • Morocco & Global Coverage
          </Badge>
          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight leading-tight">
            Automate Job Discovery &{" "}
            <span className="bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">
              Verified AI Applications
            </span>
          </h1>
          <p className="max-w-2xl mx-auto text-base sm:text-lg text-muted-foreground leading-relaxed">
            Upload your CV once, discover real openings in Morocco, France,
            Europe, and Remote hubs, score compatibility transparently, generate
            bilingual emails and PDF cover letters, and send only what you
            explicitly approve.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 pt-3">
            <Button size="lg" asChild>
              <Link href="/register">
                Create Workspace
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/dashboard">Open Dashboard</Link>
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-6 pt-6 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-emerald-500" />
              Supabase Row Level Security
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-blue-500" />
              Zero Unapproved Emails Sent
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Workflow className="h-3.5 w-3.5 text-violet-500" />
              Daily Cloud Scheduled Discovery
            </span>
          </div>
        </div>
      </section>

      {/* Feature Grid */}
      <section className="py-16 border-t bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              End-to-End Job Hunting Pipeline
            </h2>
            <p className="text-sm text-muted-foreground mt-2">
              Every module uses real database persistence, live authorized job
              feeds, and strict security controls.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((feat) => {
              const Icon = feat.icon;
              return (
                <div
                  key={feat.title}
                  className="rounded-2xl border bg-card p-6 shadow-xs hover:shadow-md transition-shadow"
                >
                  <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-600/15 to-violet-600/15 flex items-center justify-center text-primary mb-4">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-semibold text-base mb-2">{feat.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {feat.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-primary" />
            <span>AI Job Hunter — Cloud SaaS Platform</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/privacy" className="hover:text-foreground">
              Privacy Policy & Data Rights
            </Link>
            <Link href="/login" className="hover:text-foreground">
              Sign In
            </Link>
            <Link href="/register" className="hover:text-foreground">
              Register
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
