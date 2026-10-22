"use client";

import React, { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Save,
  Sparkles,
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
import { Badge, Input, Label, Textarea } from "@/components/ui/primitives";
import { toast } from "sonner";

function GeneratorInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedJobId = searchParams.get("jobId") || "";

  const [jobs, setJobs] = useState<Array<any>>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>(preselectedJobId);
  const [languageOverride, setLanguageOverride] = useState<
    "auto" | "fr" | "en"
  >("auto");

  const [loadingJobs, setLoadingJobs] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [aiConfigWarning, setAiConfigWarning] = useState<string | null>(null);

  // Editable application state
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [detectedLang, setDetectedLang] = useState<"fr" | "en">("en");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [coverLetterText, setCoverLetterText] = useState("");
  const [aiMeta, setAiMeta] = useState<string>("");

  useEffect(() => {
    fetch("/api/jobs")
      .then((r) => r.json())
      .then((d) => {
        const list = d.jobs ?? [];
        setJobs(list);
        if (preselectedJobId) {
          setSelectedJobId(preselectedJobId);
          const found = list.find((j: any) => j.id === preselectedJobId);
          if (found) {
            setDetectedLang(found.detected_language ?? "en");
            setRecipientEmail(found.public_recruitment_email ?? "");
          }
        } else if (list[0]) {
          setSelectedJobId(list[0].id);
          setDetectedLang(list[0].detected_language ?? "en");
          setRecipientEmail(list[0].public_recruitment_email ?? "");
        }
      })
      .finally(() => setLoadingJobs(false));
  }, [preselectedJobId]);

  const currentJob = jobs.find((j) => j.id === selectedJobId) ?? null;

  async function handleGenerateAi() {
    if (!selectedJobId) {
      toast.error("Please select a job opportunity first.");
      return;
    }

    setGenerating(true);
    setAiConfigWarning(null);
    try {
      const res = await fetch("/api/applications/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: selectedJobId,
          languageOverride,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.requiresConfiguration) {
          setAiConfigWarning(data.error);
        }
        toast.error(data.error || "AI generation failed.");
        return;
      }

      const app = data.application;
      setApplicationId(app.id);
      setDetectedLang(app.language);
      setRecipientEmail(app.recipient_email ?? "");
      setEmailSubject(app.email_subject);
      setEmailBody(app.email_body);
      setCoverLetterText(app.cover_letter_text);
      setAiMeta(
        `${data.generated.ai_provider.toUpperCase()} (${data.generated.ai_model})${
          data.generated.fallback_used ? " • Fallback" : ""
        }`
      );
      toast.success(
        `Generated ${app.language === "fr" ? "French" : "English"} email & PDF cover letter!`
      );
    } catch {
      toast.error("Network error during AI generation.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSaveAndQueue() {
    if (!currentJob) {
      toast.error("Select a job opportunity first.");
      return;
    }
    if (!emailSubject.trim() || !emailBody.trim() || !coverLetterText.trim()) {
      toast.error(
        "Email subject, email body, and cover letter text are all required."
      );
      return;
    }

    setSavingDraft(true);
    try {
      if (applicationId) {
        const res = await fetch(`/api/applications/${applicationId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient_email: recipientEmail.trim() || null,
            email_subject: emailSubject,
            email_body: emailBody,
            cover_letter_text: coverLetterText,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error || "Failed to save edits.");
          return;
        }
        toast.success("Application & Cover Letter PDF updated in Approval Queue!");
        router.push("/approvals");
        return;
      }

      // Create new application + generated Cover Letter PDF
      const lang =
        languageOverride === "auto"
          ? currentJob.detected_language || detectedLang
          : languageOverride;
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: currentJob.id,
          company_name: currentJob.company_name,
          job_title: currentJob.title,
          location: currentJob.location,
          job_url: currentJob.application_url,
          application_source: currentJob.source,
          match_score: currentJob.match?.match_score ?? null,
          language: lang,
          recipient_email: recipientEmail.trim() || null,
          email_subject: emailSubject,
          email_body: emailBody,
          cover_letter_text: coverLetterText,
          queue_for_approval: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Could not create application.");
        return;
      }
      setApplicationId(data.application.id);
      toast.success("Application & Cover Letter PDF queued for approval!");
      router.push("/approvals");
    } finally {
      setSavingDraft(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">
          AI Application Email & Cover Letter Generator
        </h2>
        <p className="text-sm text-muted-foreground">
          Automatically adapts to French or English job postings, highlights
          only your verified CV qualifications, builds a formatted A4 PDF cover
          letter, and queues your application for manual approval.
        </p>
      </div>

      {aiConfigWarning && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-900 dark:text-amber-200">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <strong>AI Provider Configuration Needed:</strong>{" "}
              {aiConfigWarning} You can still compose/edit your application
              below and generate a formatted PDF Cover Letter immediately.
            </div>
          </div>
          <Button size="sm" variant="outline" asChild>
            <Link href="/settings">AI Provider Settings</Link>
          </Button>
        </div>
      )}

      {/* Target Job & Language Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            1. Select Target Opportunity & Language
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingJobs ? (
            <p className="text-xs text-muted-foreground">Loading jobs...</p>
          ) : jobs.length === 0 ? (
            <div className="flex items-center justify-between rounded-xl border border-dashed p-4">
              <span className="text-sm text-muted-foreground">
                Discover at least one job opportunity before generating a
                tailored application.
              </span>
              <Button size="sm" asChild>
                <Link href="/jobs">Find Jobs</Link>
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div className="md:col-span-2 space-y-1.5">
                <Label>Discovered Job Opportunity</Label>
                <select
                  value={selectedJobId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedJobId(id);
                    setApplicationId(null);
                    const found = jobs.find((j) => j.id === id);
                    if (found) {
                      setDetectedLang(found.detected_language ?? "en");
                      setRecipientEmail(found.public_recruitment_email ?? "");
                    }
                  }}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                >
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.title} — {j.company_name} ({j.location}) [
                      {j.match?.match_score ?? "—"}%]
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Output Language</Label>
                <select
                  value={languageOverride}
                  onChange={(e) => setLanguageOverride(e.target.value as any)}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                >
                  <option value="auto">
                    Auto-Detect ({currentJob?.detected_language === "fr" ? "French" : "English"})
                  </option>
                  <option value="fr">French (Français)</option>
                  <option value="en">English</option>
                </select>
              </div>

              <Button
                type="button"
                onClick={handleGenerateAi}
                disabled={generating || !selectedJobId}
              >
                {generating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
                {generating ? "Generating..." : "Generate with AI"}
              </Button>
            </div>
          )}

          {currentJob && (
            <div className="rounded-xl bg-muted/50 p-3.5 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  Detected Posting Language:{" "}
                  {currentJob.detected_language === "fr" ? "French" : "English"}
                </Badge>
                {currentJob.match && (
                  <Badge variant="secondary">
                    Match Score: {currentJob.match.match_score}%
                  </Badge>
                )}
                {aiMeta && <Badge>{aiMeta}</Badge>}
              </div>
              <a
                href={currentJob.application_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary font-medium hover:underline"
              >
                View Original Posting
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Email & Cover Letter Editor */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              2. Personalized Application Email
            </CardTitle>
            <CardDescription>
              Edit recipient, subject, or message before queueing for approval
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>
                Verified Recruitment Email (Leave empty if applying on official
                portal)
              </Label>
              <Input
                type="email"
                placeholder="recrutement@company.com (never guessed)"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
              />
              {!recipientEmail && currentJob?.application_url && (
                <p className="text-[11px] text-muted-foreground">
                  No verified email published in this listing. You can still
                  generate the Cover Letter PDF and apply directly via{" "}
                  <a
                    href={currentJob.application_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    the official application page
                  </a>
                  .
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Email Subject</Label>
              <Input
                placeholder={
                  detectedLang === "fr"
                    ? "Candidature au poste de..."
                    : "Application for..."
                }
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Email Body</Label>
              <Textarea
                rows={13}
                placeholder="Generate with AI above or write your personalized application email..."
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">
                3. Tailored Cover Letter & PDF
              </CardTitle>
              <CardDescription>
                Formatted into an executive A4 PDF stored in private Supabase
                Storage
              </CardDescription>
            </div>
            {applicationId && (
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`/api/applications/${applicationId}/document?type=cover_letter`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download className="h-3.5 w-3.5" />
                  Cover Letter PDF
                </a>
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Cover Letter Content ({detectedLang.toUpperCase()})</Label>
              <Textarea
                rows={17}
                placeholder="Generate with AI above or draft your cover letter paragraphs here..."
                value={coverLetterText}
                onChange={(e) => setCoverLetterText(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileText className="h-4 w-4 text-primary" />
                <span>Original CV + Cover Letter PDF attached on approval</span>
              </div>
              <Button
                type="button"
                onClick={handleSaveAndQueue}
                disabled={savingDraft || !currentJob}
              >
                {savingDraft ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save & Send to Approval Queue
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function GeneratorPage() {
  return (
    <Suspense
      fallback={
        <div className="py-16 text-center text-sm text-muted-foreground">
          Loading AI Application Generator...
        </div>
      }
    >
      <GeneratorInner />
    </Suspense>
  );
}
