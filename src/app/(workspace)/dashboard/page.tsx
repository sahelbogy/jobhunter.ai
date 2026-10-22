"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Briefcase,
  CheckCircle2,
  Circle,
  ClipboardList,
  FileText,
  Loader2,
  Mail,
  Send,
  Sparkles,
  Target,
  Trophy,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/primitives";
import { formatRelativeDate, scoreColorClasses } from "@/lib/utils";

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [resumesCount, setResumesCount] = useState(0);
  const [emailConnected, setEmailConnected] = useState(false);
  const [topMatches, setTopMatches] = useState<any[]>([]);

  useEffect(() => {
    async function loadDashboard() {
      setLoading(true);
      try {
        const [anRes, profRes, cvRes, emRes, matchRes] = await Promise.all([
          fetch("/api/analytics"),
          fetch("/api/profile"),
          fetch("/api/cv"),
          fetch("/api/email/status"),
          fetch("/api/matching?minScore=0"),
        ]);

        if (anRes.ok) setAnalytics(await anRes.json());
        if (profRes.ok) {
          const d = await profRes.json();
          setProfile(d.profile);
        }
        if (cvRes.ok) {
          const d = await cvRes.json();
          setResumesCount((d.resumes ?? []).length);
        }
        if (emRes.ok) {
          const d = await emRes.json();
          setEmailConnected(Boolean(d.connection?.is_active));
        }
        if (matchRes.ok) {
          const d = await matchRes.json();
          setTopMatches((d.matches ?? []).slice(0, 5));
        }
      } finally {
        setLoading(false);
      }
    }
    loadDashboard();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span>Loading workspace intelligence...</span>
      </div>
    );
  }

  const kpis = analytics?.kpis ?? {
    jobsDiscovered: 0,
    relevantMatches: 0,
    applicationsGenerated: 0,
    applicationsApproved: 0,
    applicationsSent: 0,
    interviews: 0,
    offers: 0,
    awaitingApproval: 0,
  };

  const steps = [
    {
      done: resumesCount > 0,
      label: "Upload your PDF CV",
      href: "/cv",
      cta: "Upload CV",
    },
    {
      done: Boolean(
        profile?.professional_title &&
          (profile?.technical_skills?.length ?? 0) > 0
      ),
      label: "Verify your professional profile & skills",
      href: "/profile",
      cta: "Edit Profile",
    },
    {
      done: kpis.jobsDiscovered > 0,
      label: "Discover live job opportunities",
      href: "/jobs",
      cta: "Find Jobs",
    },
    {
      done: emailConnected,
      label: "Connect Gmail OAuth 2.0 for sending",
      href: "/emails",
      cta: "Connect Email",
    },
  ];

  const statCards = [
    {
      title: "Jobs Discovered",
      value: kpis.jobsDiscovered,
      sub: "Deduplicated verified roles",
      icon: Briefcase,
      color: "text-blue-600 dark:text-blue-400",
    },
    {
      title: "Relevant Matches (65%+)",
      value: kpis.relevantMatches,
      sub: "Ranked by CV compatibility",
      icon: Target,
      color: "text-violet-600 dark:text-violet-400",
    },
    {
      title: "Awaiting Approval",
      value: kpis.awaitingApproval,
      sub: `${kpis.applicationsGenerated} total generated`,
      icon: Wand2,
      color: "text-amber-600 dark:text-amber-400",
    },
    {
      title: "Applications Sent",
      value: kpis.applicationsSent,
      sub: `${kpis.interviews} interviews • ${kpis.offers} offers`,
      icon: Send,
      color: "text-emerald-600 dark:text-emerald-400",
    },
  ];

  return (
    <div className="space-y-8">
      {/* Welcome Banner */}
      <div className="rounded-2xl border bg-gradient-to-r from-blue-600/10 via-violet-600/10 to-transparent p-6 sm:p-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-primary">
            <Sparkles className="h-4 w-4" />
            AI JOB HUNTER WORKSPACE
          </div>
          <h2 className="text-2xl font-bold tracking-tight">
            {profile?.full_name
              ? `Welcome back, ${profile.full_name}`
              : "Welcome to your Career Automation Hub"}
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {profile?.professional_title
              ? `${profile.professional_title} • ${profile.location || "Morocco & Global"}`
              : "Upload your CV and run job discovery to match against live openings in Morocco, France, Europe, and Remote markets."}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" asChild>
            <Link href="/cv">
              <FileText className="h-4 w-4" />
              My CV
            </Link>
          </Button>
          <Button asChild>
            <Link href="/jobs">
              <Briefcase className="h-4 w-4" />
              Discover Jobs
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {statCards.map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.title}>
              <CardContent className="p-6 flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    {s.title}
                  </p>
                  <p className="text-3xl font-bold tracking-tight">{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.sub}</p>
                </div>
                <div className="rounded-xl bg-muted p-2.5">
                  <Icon className={`h-5 w-5 ${s.color}`} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Pending Approvals Callout */}
      {kpis.awaitingApproval > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              {kpis.awaitingApproval} application draft(s) awaiting your manual
              review & approval
            </p>
            <p className="text-xs text-amber-700/90 dark:text-amber-300/90">
              Mandatory security policy: no application email is ever sent
              without your explicit approval.
            </p>
          </div>
          <Button size="sm" asChild>
            <Link href="/approvals">
              Review Queue
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Onboarding Checklist */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Workspace Readiness</CardTitle>
            <CardDescription>
              Complete these steps for full automation
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {steps.map((step) => (
              <div
                key={step.label}
                className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {step.done ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <span
                    className={
                      step.done ? "line-through text-muted-foreground truncate" : "truncate"
                    }
                  >
                    {step.label}
                  </span>
                </div>
                <Link
                  href={step.href}
                  className="text-xs font-medium text-primary hover:underline shrink-0"
                >
                  {step.cta}
                </Link>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Top Compatibility Matches */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">
                Top Ranked Job Matches
              </CardTitle>
              <CardDescription>
                Highest compatibility opportunities in your workspace
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/matching">View All</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {topMatches.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center space-y-3">
                <Target className="h-8 w-8 text-muted-foreground mx-auto" />
                <p className="text-sm font-medium">No matched jobs yet</p>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  Run the Job Discovery Engine to pull real vacancies from
                  Morocco, France, Europe, and Remote feeds and score them
                  against your CV.
                </p>
                <Button size="sm" asChild>
                  <Link href="/jobs">Discover Jobs Now</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {topMatches.map((m) => (
                  <div
                    key={m.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-3.5 hover:bg-muted/40 transition-colors"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm truncate">
                          {m.job?.title}
                        </span>
                        <Badge
                          className={scoreColorClasses(m.match_score)}
                        >
                          Match Score: {m.match_score}%
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {m.job?.company_name} • {m.job?.location} • Source:{" "}
                        {m.job?.source}
                      </p>
                    </div>
                    <Button size="sm" variant="secondary" asChild>
                      <Link href={`/generator?jobId=${m.job_id}`}>
                        Generate Draft
                      </Link>
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Activity Feed */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Recent Activity</CardTitle>
            <CardDescription>
              Real-time log of applications, email deliveries, and scheduled
              runs
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/tracker">
              <ClipboardList className="h-4 w-4" />
              Tracker
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {(analytics?.activity ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">
              No activity recorded yet. Actions you take across jobs, AI
              generation, approvals, and emails will appear here.
            </p>
          ) : (
            <div className="divide-y">
              {analytics.activity.map((item: any) => (
                <div
                  key={item.id}
                  className="py-3 flex items-center justify-between gap-4 text-sm"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {item.type === "email" ? (
                      <Mail className="h-4 w-4 text-emerald-500 shrink-0" />
                    ) : item.type === "automation" ? (
                      <Trophy className="h-4 w-4 text-violet-500 shrink-0" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-blue-500 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium truncate">{item.title}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {item.detail}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatRelativeDate(item.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
