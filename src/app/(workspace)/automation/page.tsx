"use client";

import React, { useEffect, useState } from "react";
import {
  Bot,
  Clock,
  Loader2,
  Play,
  Save,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge, Input, Label } from "@/components/ui/primitives";
import { formatShortDate } from "@/lib/utils";
import { toast } from "sonner";

export default function AutomationPage() {
  const [isEnabled, setIsEnabled] = useState(false);
  const [locationsText, setLocationsText] = useState(
    "Morocco, France, Europe, Remote"
  );
  const [sectorsText, setSectorsText] = useState("Software & IT, Cloud & AI");
  const [keywordsText, setKeywordsText] = useState("");
  const [includeRemote, setIncludeRemote] = useState(true);
  const [minMatchScore, setMinMatchScore] = useState(70);
  const [maxOpportunities, setMaxOpportunities] = useState(25);
  const [maxDrafts, setMaxDrafts] = useState(3);
  const [aiProvider, setAiProvider] = useState<"groq" | "gemini" | "xai">(
    "groq"
  );
  const [emailLanguage, setEmailLanguage] = useState<"auto" | "fr" | "en">(
    "auto"
  );
  const [notifyInApp, setNotifyInApp] = useState(true);

  const [runs, setRuns] = useState<Array<any>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningNow, setRunningNow] = useState(false);

  async function loadAutomation() {
    setLoading(true);
    try {
      const res = await fetch("/api/automation");
      if (res.ok) {
        const d = await res.json();
        const s = d.settings ?? {};
        setIsEnabled(Boolean(s.is_enabled));
        if (Array.isArray(s.search_locations) && s.search_locations.length > 0) {
          setLocationsText(s.search_locations.join(", "));
        }
        if (
          Array.isArray(s.preferred_sectors) &&
          s.preferred_sectors.length > 0
        ) {
          setSectorsText(s.preferred_sectors.join(", "));
        }
        if (Array.isArray(s.search_keywords)) {
          setKeywordsText(s.search_keywords.join(", "));
        }
        setIncludeRemote(s.include_remote ?? true);
        setMinMatchScore(s.min_match_score ?? 70);
        setMaxOpportunities(s.max_opportunities_per_run ?? 25);
        setMaxDrafts(s.max_drafts_per_run ?? 3);
        setAiProvider(s.ai_provider ?? "groq");
        setEmailLanguage(s.email_language ?? "auto");
        setNotifyInApp(s.notify_in_app ?? true);
        setRuns(d.runs ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAutomation();
  }, []);

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const splitCsv = (v: string) =>
        v
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);

      const res = await fetch("/api/automation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_enabled: isEnabled,
          schedule_cron: "0 7 * * *",
          search_locations: splitCsv(locationsText),
          preferred_sectors: splitCsv(sectorsText),
          search_keywords: splitCsv(keywordsText),
          include_remote: includeRemote,
          min_match_score: Number(minMatchScore),
          max_opportunities_per_run: Number(maxOpportunities),
          auto_generate_drafts: true,
          max_drafts_per_run: Number(maxDrafts),
          ai_provider: aiProvider,
          fallback_ai_provider: null,
          email_language: emailLanguage,
          notify_in_app: notifyInApp,
          notify_email: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Could not save automation settings.");
        return;
      }
      toast.success("Cloud automation settings updated!");
    } finally {
      setSaving(false);
    }
  }

  async function handleRunNow() {
    setRunningNow(true);
    try {
      const res = await fetch("/api/automation/run", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Automation run failed.");
        return;
      }
      if (data.status === "skipped_locked") {
        toast.warning(data.errorMessage || "A run is already in progress.");
        return;
      }
      toast.success(
        `Automation complete: ${data.jobsDiscovered} jobs scanned, ${data.jobsMatched} matched, ${data.draftsGenerated} drafts queued for approval.`
      );
      await loadAutomation();
    } finally {
      setRunningNow(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Cloud Automation Engine</h2>
          <p className="text-sm text-muted-foreground">
            Scheduled Vercel Cron pipeline (<code>0 7 * * *</code> UTC) that
            discovers jobs, deduplicates listings, calculates match scores, and
            prepares tailored drafts in your Approval Queue.
          </p>
        </div>
        <Button onClick={handleRunNow} disabled={runningNow}>
          {runningNow ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {runningNow ? "Running Pipeline..." : "Run Pipeline Now"}
        </Button>
      </div>

      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 flex items-start gap-3 text-xs text-emerald-900 dark:text-emerald-200">
        <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          <strong>Zero Unapproved Sends Guarantee:</strong> Scheduled cloud
          automation NEVER transmits emails. High-scoring opportunities are
          prepared strictly as <code>Awaiting Approval</code> items inside your
          Approval Queue with distributed lock protection against duplicate runs.
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Scheduled Discovery & Draft Preparation Rules
          </CardTitle>
          <CardDescription>
            Customize locations, sectors, compatibility threshold, AI provider,
            and daily draft cap
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading settings...</p>
          ) : (
            <form onSubmit={handleSaveSettings} className="space-y-5">
              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2.5 text-sm font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={(e) => setIsEnabled(e.target.checked)}
                    className="h-4 w-4 rounded border-input accent-blue-600"
                  />
                  Enable Daily Cloud Automation (07:00 UTC)
                </label>

                <label className="flex items-center gap-2.5 text-sm font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeRemote}
                    onChange={(e) => setIncludeRemote(e.target.checked)}
                    className="h-4 w-4 rounded border-input accent-blue-600"
                  />
                  Include Remote Opportunities
                </label>

                <label className="flex items-center gap-2.5 text-sm font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyInApp}
                    onChange={(e) => setNotifyInApp(e.target.checked)}
                    className="h-4 w-4 rounded border-input accent-blue-600"
                  />
                  In-App High-Match Notifications
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label>Target Locations (comma-separated)</Label>
                  <Input
                    value={locationsText}
                    onChange={(e) => setLocationsText(e.target.value)}
                    placeholder="Morocco, France, Europe, Remote"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Preferred Sectors (comma-separated)</Label>
                  <Input
                    value={sectorsText}
                    onChange={(e) => setSectorsText(e.target.value)}
                    placeholder="Software & IT, FinTech"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Search Keywords (comma-separated)</Label>
                  <Input
                    value={keywordsText}
                    onChange={(e) => setKeywordsText(e.target.value)}
                    placeholder="TypeScript, Next.js, Data Engineer"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Minimum Match Score (%)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={minMatchScore}
                    onChange={(e) => setMinMatchScore(Number(e.target.value))}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Max Opportunities per Run (1–50)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={maxOpportunities}
                    onChange={(e) =>
                      setMaxOpportunities(Number(e.target.value))
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Max Auto-Drafts per Run (0–10)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    value={maxDrafts}
                    onChange={(e) => setMaxDrafts(Number(e.target.value))}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Draft Generation AI Provider</Label>
                  <select
                    value={aiProvider}
                    onChange={(e) => setAiProvider(e.target.value as any)}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  >
                    <option value="groq">Groq Cloud (Default)</option>
                    <option value="gemini">Google Gemini</option>
                    <option value="xai">xAI Grok</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label>Generated Application Language</Label>
                  <select
                    value={emailLanguage}
                    onChange={(e) => setEmailLanguage(e.target.value as any)}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  >
                    <option value="auto">Auto-Detect (FR / EN)</option>
                    <option value="fr">French (Français)</option>
                    <option value="en">English</option>
                  </select>
                </div>
              </div>

              <Button type="submit" disabled={saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save Automation Rules
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Automation Run History</CardTitle>
          <CardDescription>
            Execution logs, deduplication counts, and error telemetry
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground space-y-2">
              <Bot className="h-7 w-7 text-primary mx-auto" />
              <p>
                No automation runs logged yet. Click{" "}
                <strong>Run Pipeline Now</strong> above to execute a live cloud
                pass.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {runs.map((r) => (
                <div
                  key={r.id}
                  className="rounded-xl border p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant={
                          r.status === "completed"
                            ? "success"
                            : r.status === "failed"
                            ? "destructive"
                            : "warning"
                        }
                      >
                        {r.status}
                      </Badge>
                      <Badge variant="outline">{r.trigger_type}</Badge>
                      <span className="font-medium">
                        {r.jobs_discovered} discovered • {r.jobs_deduplicated}{" "}
                        unique • {r.jobs_matched} matched •{" "}
                        {r.drafts_generated} drafts queued
                      </span>
                    </div>
                    {r.error_message && (
                      <p className="text-amber-700 dark:text-amber-300">
                        Note: {r.error_message}
                      </p>
                    )}
                  </div>
                  <div className="text-muted-foreground flex items-center gap-1.5 shrink-0">
                    <Clock className="h-3.5 w-3.5" />
                    <span>{formatShortDate(r.started_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
