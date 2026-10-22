"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Cpu,
  Download,
  ExternalLink,
  Loader2,
  Save,
  Shield,
  Trash2,
  Zap,
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
import { toast } from "sonner";

export default function SettingsPage() {
  const router = useRouter();
  const [providers, setProviders] = useState<Array<any>>([]);
  const [primaryProvider, setPrimaryProvider] = useState<
    "groq" | "gemini" | "xai"
  >("groq");
  const [primaryModel, setPrimaryModel] = useState("llama-3.3-70b-versatile");
  const [fallbackProvider, setFallbackProvider] = useState<
    "groq" | "gemini" | "xai" | "none"
  >("none");
  const [allowPaidFallback, setAllowPaidFallback] = useState(false);
  const [recentLogs, setRecentLogs] = useState<Array<any>>([]);

  const [savingAi, setSavingAi] = useState(false);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);

  async function loadAiSettings() {
    const res = await fetch("/api/ai/providers");
    if (res.ok) {
      const d = await res.json();
      setProviders(d.providers ?? []);
      if (d.preferences) {
        setPrimaryProvider(d.preferences.primary_ai_provider ?? "groq");
        setPrimaryModel(
          d.preferences.primary_ai_model ?? "llama-3.3-70b-versatile"
        );
        setFallbackProvider(d.preferences.fallback_ai_provider ?? "none");
        setAllowPaidFallback(Boolean(d.preferences.allow_paid_fallback));
      }
      setRecentLogs(d.recentLogs ?? []);
    }
  }

  useEffect(() => {
    loadAiSettings();
  }, []);

  const currentProviderModels: Array<{ id: string; label: string }> =
    providers.find((p) => p.id === primaryProvider)?.models ?? [];

  async function handleSaveAiPrefs(e: React.FormEvent) {
    e.preventDefault();
    setSavingAi(true);
    try {
      const res = await fetch("/api/ai/providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primary_ai_provider: primaryProvider,
          primary_ai_model: primaryModel,
          fallback_ai_provider:
            fallbackProvider === "none" ? null : fallbackProvider,
          fallback_ai_model: null,
          allow_paid_fallback: allowPaidFallback,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to update AI provider preferences.");
        return;
      }
      toast.success("AI provider routing saved!");
    } finally {
      setSavingAi(false);
    }
  }

  async function handleTestProvider(providerId: "groq" | "gemini" | "xai") {
    setTestingProvider(providerId);
    try {
      const res = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerId,
          model: providerId === primaryProvider ? primaryModel : undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(
          `${providerId.toUpperCase()} verified (${data.model}, ${data.latencyMs}ms)!`
        );
      } else {
        toast.error(
          data.error || data.message || `${providerId.toUpperCase()} test failed.`
        );
      }
      await loadAiSettings();
    } finally {
      setTestingProvider(null);
    }
  }

  async function handleDeleteAccount() {
    if (deleteConfirmation !== "DELETE MY ACCOUNT") {
      toast.error('Please type exactly "DELETE MY ACCOUNT" to confirm.');
      return;
    }
    setDeletingAccount(true);
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Account deletion failed.");
        return;
      }
      toast.success("Your account and all data have been permanently deleted.");
      router.push("/");
    } finally {
      setDeletingAccount(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">
          Account, AI Provider & Privacy Settings
        </h2>
        <p className="text-sm text-muted-foreground">
          Configure modular cloud AI providers, test server-side API
          connections, export your GDPR data archive, or permanently delete your
          account.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2.5">
            <Cpu className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-base">
                Modular Cloud AI Provider Layer
              </CardTitle>
              <CardDescription>
                Primary Groq + Secondary Gemini + Optional xAI Grok. Never
                silently switches to a paid provider unless explicitly allowed.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {providers.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border p-4 flex flex-col justify-between gap-3 text-xs"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm">
                      {p.name || p.id.toUpperCase()}
                    </span>
                    {p.configured ? (
                      <Badge variant="success">Key Configured</Badge>
                    ) : (
                      <Badge variant="warning">Missing Env Key</Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground">
                    Default model: <code>{p.defaultModel}</code>
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={testingProvider === p.id}
                  onClick={() => handleTestProvider(p.id)}
                >
                  {testingProvider === p.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Zap className="h-3.5 w-3.5" />
                  )}
                  Test Connection
                </Button>
              </div>
            ))}
          </div>

          <form onSubmit={handleSaveAiPrefs} className="space-y-4 border-t pt-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Primary AI Provider</Label>
                <select
                  value={primaryProvider}
                  onChange={(e) => {
                    const next = e.target.value as "groq" | "gemini" | "xai";
                    setPrimaryProvider(next);
                    const found = providers.find((pr) => pr.id === next);
                    if (found?.defaultModel) {
                      setPrimaryModel(found.defaultModel);
                    }
                  }}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                >
                  <option value="groq">Groq Cloud (Primary Default)</option>
                  <option value="gemini">Google Gemini API</option>
                  <option value="xai">xAI Grok API (Optional)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Preferred Primary Model</Label>
                <select
                  value={primaryModel}
                  onChange={(e) => setPrimaryModel(e.target.value)}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                >
                  {currentProviderModels.length > 0 ? (
                    currentProviderModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label ? `${m.label} (${m.id})` : m.id}
                      </option>
                    ))
                  ) : (
                    <option value={primaryModel}>{primaryModel}</option>
                  )}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Explicit Fallback Provider</Label>
                <select
                  value={fallbackProvider}
                  onChange={(e) => setFallbackProvider(e.target.value as any)}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                >
                  <option value="none">
                    Disabled (Never switch providers automatically)
                  </option>
                  <option value="gemini">Google Gemini API</option>
                  <option value="groq">Groq Cloud</option>
                  <option value="xai">xAI Grok API (Paid)</option>
                </select>
              </div>
            </div>

            <label className="flex items-center gap-2.5 text-xs font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={allowPaidFallback}
                onChange={(e) => setAllowPaidFallback(e.target.checked)}
                className="h-4 w-4 rounded border-input accent-blue-600"
              />
              Allow paid fallback provider (required only if xAI Grok is chosen
              as fallback)
            </label>

            <Button type="submit" disabled={savingAi}>
              {savingAi ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save AI Routing Configuration
            </Button>
          </form>

          {recentLogs.length > 0 && (
            <div className="border-t pt-4 space-y-2">
              <div className="text-xs font-semibold">
                Recent AI Invocation Telemetry
              </div>
              <div className="space-y-1.5">
                {recentLogs.slice(0, 5).map((log) => (
                  <div
                    key={log.id}
                    className="rounded-lg bg-muted/50 px-3 py-2 flex items-center justify-between text-xs"
                  >
                    <span>
                      <strong>{log.task_type}</strong> via{" "}
                      <code>
                        {log.provider}/{log.model}
                      </code>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        {log.latency_ms}ms
                      </span>
                      <Badge
                        variant={
                          log.status === "success" ? "success" : "destructive"
                        }
                      >
                        {log.status}
                      </Badge>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2.5">
            <Shield className="h-5 w-5 text-emerald-600" />
            <div>
              <CardTitle className="text-base">
                Privacy Policy & GDPR Data Portability
              </CardTitle>
              <CardDescription>
                Inspect our data-minimization commitments or export your entire
                structured account archive
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button variant="outline" asChild>
            <Link href="/privacy" target="_blank">
              Read Privacy & Data Policy
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </Button>
          <Button variant="secondary" asChild>
            <a href="/api/account" download>
              <Download className="h-4 w-4" />
              Download All My Data (JSON)
            </a>
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <div className="flex items-center gap-2.5 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <div>
              <CardTitle className="text-base">
                Delete Account & Purge All Stored Data
              </CardTitle>
              <CardDescription>
                Permanently deletes your Supabase Auth user, all user rows
                across every database table, encrypted email tokens, uploaded CV
                PDFs, and generated Cover Letter PDFs.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 max-w-md">
          <div className="space-y-1.5">
            <Label className="text-xs">
              Type <code>DELETE MY ACCOUNT</code> to confirm irreversible
              erasure:
            </Label>
            <Input
              value={deleteConfirmation}
              onChange={(e) => setDeleteConfirmation(e.target.value)}
              placeholder="DELETE MY ACCOUNT"
            />
          </div>
          <Button
            variant="destructive"
            disabled={
              deletingAccount || deleteConfirmation !== "DELETE MY ACCOUNT"
            }
            onClick={handleDeleteAccount}
          >
            {deletingAccount ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Permanently Delete Account & Data
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
