"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bot,
  CalendarClock,
  Clock,
  Loader2,
  MailCheck,
  Play,
  Save,
  Send,
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
  const [scheduleMode, setScheduleMode] = useState<
    "daily" | "specific_date" | "manual_only"
  >("daily");
  const [scheduledDate, setScheduledDate] = useState<string>(() => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return tomorrow.toISOString().slice(0, 10);
  });
  const [locationsText, setLocationsText] = useState("Morocco");
  const [sectorsText, setSectorsText] = useState("Software & IT, Cloud & AI");
  const [keywordsText, setKeywordsText] = useState("");
  const [includeRemote, setIncludeRemote] = useState(false);
  const [minMatchScore, setMinMatchScore] = useState(70);
  const [maxOpportunities, setMaxOpportunities] = useState(25);
  const [maxDrafts, setMaxDrafts] = useState(5);
  const [aiProvider, setAiProvider] = useState<"groq" | "gemini" | "xai">(
    "groq"
  );
  const [emailLanguage, setEmailLanguage] = useState<"auto" | "fr" | "en">(
    "auto"
  );
  const [notifyInApp, setNotifyInApp] = useState(true);

  // Email Approval loop settings
  const [emailApprovalEnabled, setEmailApprovalEnabled] = useState(true);
  const [approvalEmailRecipient, setApprovalEmailRecipient] = useState("");
  const [autoSendOnEmailApproval, setAutoSendOnEmailApproval] = useState(true);
  const [emailConnection, setEmailConnection] = useState<{
    provider: string;
    email_address: string;
    is_active: boolean;
  } | null>(null);
  const [emailApprovals, setEmailApprovals] = useState<Array<any>>([]);
  const [testingEmailApproval, setTestingEmailApproval] = useState(false);

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
        setScheduleMode(s.schedule_mode ?? "daily");
        if (s.scheduled_date) {
          setScheduledDate(s.scheduled_date);
        }
        if (
          Array.isArray(s.search_locations) &&
          s.search_locations.length > 0
        ) {
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
        setMaxDrafts(s.max_drafts_per_run ?? 5);
        setAiProvider(
          s.ai_provider === "xai" ? "groq" : (s.ai_provider ?? "groq")
        );
        setEmailLanguage(s.email_language ?? "auto");
        setNotifyInApp(s.notify_in_app ?? true);
        setEmailApprovalEnabled(s.email_approval_enabled !== false);
        setApprovalEmailRecipient(
          s.approval_email_recipient || d.emailConnection?.email_address || ""
        );
        setAutoSendOnEmailApproval(s.auto_send_on_email_approval !== false);
        setRuns(d.runs ?? []);
        setEmailApprovals(d.emailApprovals ?? []);
        setEmailConnection(d.emailConnection ?? null);

        if (!s.approval_email_recipient && !d.emailConnection?.email_address) {
          const profRes = await fetch("/api/profile").catch(() => null);
          if (profRes && profRes.ok) {
            const pd = await profRes.json();
            if (pd.profile?.email) {
              setApprovalEmailRecipient(pd.profile.email);
            }
          }
        }
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
      const res = await fetch("/api/automation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_enabled: isEnabled,
          schedule_cron: "0 7 * * *",
          schedule_mode: scheduleMode,
          scheduled_date:
            scheduleMode === "specific_date" ? scheduledDate : null,
          search_locations: locationsText
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          preferred_sectors: sectorsText
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          search_keywords: keywordsText
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          include_remote: includeRemote,
          min_match_score: Number(minMatchScore),
          max_opportunities_per_run: Number(maxOpportunities),
          auto_generate_drafts: maxDrafts > 0,
          max_drafts_per_run: Number(maxDrafts),
          ai_provider: aiProvider,
          fallback_ai_provider: null,
          email_language: emailLanguage,
          notify_in_app: notifyInApp,
          notify_email: emailApprovalEnabled,
          email_approval_enabled: emailApprovalEnabled,
          approval_email_recipient: approvalEmailRecipient.trim(),
          auto_send_on_email_approval: autoSendOnEmailApproval,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to save automation settings.");
        return;
      }
      toast.success(
        "Paramètres d'automatisation et de validation par email enregistrés !"
      );
      await loadAutomation();
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
        toast.error(data.error || "Automation execution failed.");
        return;
      }
      toast.success(
        `Pipeline terminé : ${data.jobsDiscovered} offres scannées, ${data.jobsMatched} qualifiées, ${data.draftsGenerated} candidatures préparées.`
      );
      await loadAutomation();
    } finally {
      setRunningNow(false);
    }
  }

  async function handleTestEmailApproval() {
    setTestingEmailApproval(true);
    try {
      const res = await fetch("/api/email/approval-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approverEmail: approvalEmailRecipient.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(
          data.error || "Impossible d'envoyer l'email test de validation."
        );
        return;
      }
      toast.success(
        `Email test de validation envoyé à ${data.approverEmail} !`
      );
    } finally {
      setTestingEmailApproval(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">
            Cloud Automation &amp; Email Approval Loop
          </h2>
          <p className="text-sm text-muted-foreground">
            Automatisez vos postulations <strong>chaque jour</strong> ou{" "}
            <strong>un jour précis</strong> : l&apos;IA génère le mail + Lettre de
            Motivation PDF, vous envoie tout dans votre boîte email pour
            validation, et expédie directement au recruteur dès votre clic sur{" "}
            <strong>Approuver &amp; Envoyer</strong>.
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
          <strong>Garantie Zéro Envoi Sans Validation Humaine :</strong> Aucun
          email n&apos;est envoyé au recruteur sans votre confirmation explicite
          (jeton signé HMAC-SHA256 + empreinte SHA-256 du destinataire, du texte
          et des PDF dans votre email de validation, ou dans Approval Queue).
        </div>
      </div>

      <form onSubmit={handleSaveSettings} className="space-y-6">
        {/* Card 1: Schedule & Discovery Rules */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">
                  1. Planification (Chaque Jour ou Jour Précis) &amp; Filtres
                </CardTitle>
                <CardDescription>
                  Choisissez la fréquence d&apos;exécution, le pays strict (ex:{" "}
                  <code>Morocco</code> uniquement) et le nombre d&apos;offres à
                  préparer (ex: 5 offres)
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setLocationsText("Morocco");
                  setIncludeRemote(false);
                  toast.info(
                    "Région réglée sur 'Morocco' uniquement (sans France ni autres pays)."
                  );
                }}
              >
                🇲🇦 Maroc Uniquement
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {loading ? (
              <p className="text-xs text-muted-foreground">
                Chargement des paramètres...
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-6">
                  <label className="flex items-center gap-2.5 text-sm font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={(e) => setIsEnabled(e.target.checked)}
                      className="h-4 w-4 rounded border-input accent-blue-600"
                    />
                    Activer l&apos;automatisation planifiée (07:00 UTC)
                  </label>

                  <label className="flex items-center gap-2.5 text-sm font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeRemote}
                      onChange={(e) => setIncludeRemote(e.target.checked)}
                      className="h-4 w-4 rounded border-input accent-blue-600"
                    />
                    Inclure aussi les offres 100% Remote hors région cible
                  </label>

                  <label className="flex items-center gap-2.5 text-sm font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notifyInApp}
                      onChange={(e) => setNotifyInApp(e.target.checked)}
                      className="h-4 w-4 rounded border-input accent-blue-600"
                    />
                    Notifications dans l&apos;application
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 rounded-xl border bg-muted/30 p-3.5">
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5">
                      <CalendarClock className="h-3.5 w-3.5 text-blue-600" />
                      Mode de planification
                    </Label>
                    <select
                      value={scheduleMode}
                      onChange={(e) =>
                        setScheduleMode(
                          e.target.value as
                            | "daily"
                            | "specific_date"
                            | "manual_only"
                        )
                      }
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    >
                      <option value="daily">
                        Chaque jour (Quotidien automatique)
                      </option>
                      <option value="specific_date">
                        Un jour précis (Date choisie)
                      </option>
                      <option value="manual_only">
                        Manuel uniquement (Run Now)
                      </option>
                    </select>
                  </div>

                  {scheduleMode === "specific_date" && (
                    <div className="space-y-1.5">
                      <Label>Date précise d&apos;exécution</Label>
                      <Input
                        type="date"
                        value={scheduledDate}
                        onChange={(e) => setScheduledDate(e.target.value)}
                      />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label>Nombre d&apos;offres préparées par lot (0–10)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={10}
                      value={maxDrafts}
                      onChange={(e) => setMaxDrafts(Number(e.target.value))}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label>Régions Cibles Strictes (séparées par virgule)</Label>
                    <Input
                      value={locationsText}
                      onChange={(e) => setLocationsText(e.target.value)}
                      placeholder="Morocco"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Secteurs Préférés</Label>
                    <Input
                      value={sectorsText}
                      onChange={(e) => setSectorsText(e.target.value)}
                      placeholder="Software & IT, FinTech"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Mots-clés (optionnel — sinon basé sur le CV)</Label>
                    <Input
                      value={keywordsText}
                      onChange={(e) => setKeywordsText(e.target.value)}
                      placeholder="Full Stack, Data, DevOps"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Score de compatibilité minimum (%)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={minMatchScore}
                      onChange={(e) => setMinMatchScore(Number(e.target.value))}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Max offres scannées par exécution (1–50)</Label>
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
                    <Label>Langue des candidatures générées</Label>
                    <select
                      value={emailLanguage}
                      onChange={(e) => setEmailLanguage(e.target.value as any)}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    >
                      <option value="auto">
                        Auto-détection selon l&apos;offre (FR / EN)
                      </option>
                      <option value="fr">Français (FR)</option>
                      <option value="en">Anglais (EN)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Fournisseur IA Principal (100% Gratuit)</Label>
                    <select
                      value={aiProvider}
                      onChange={(e) => setAiProvider(e.target.value as any)}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    >
                      <option value="groq">
                        Groq Cloud — 100% Gratuit (Recommandé)
                      </option>
                      <option value="gemini">
                        Google Gemini AI Studio — 100% Gratuit
                      </option>
                    </select>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Card 2: Email Approval -> Direct Employer Dispatch */}
        <Card className="border-blue-500/40">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <MailCheck className="h-4 w-4 text-blue-600" />
                  2. Validation par Email &rarr; Envoi Direct au Recruteur
                </CardTitle>
                <CardDescription>
                  Recevez dans votre boîte email l&apos;aperçu complet du mail +
                  la Lettre de Motivation PDF en pièce jointe avec les boutons{" "}
                  <strong>Approuver &amp; Envoyer</strong> et{" "}
                  <strong>Refuser</strong>
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {emailConnection?.is_active ? (
                  <Badge variant="success">
                    Boîte connectée : {emailConnection.email_address}
                  </Badge>
                ) : (
                  <Badge variant="warning">
                    Connectez votre boîte dans Email Center
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!emailConnection?.is_active ? (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-amber-950 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2">
                <span>
                  Connectez votre Gmail (Mot de passe d&apos;application gratuit
                  16 caractères ou OAuth) pour activer l&apos;envoi des emails de
                  validation et des candidatures.
                </span>
                <Link
                  href="/emails"
                  className="inline-flex h-8 items-center rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  Ouvrir Email Center &rarr;
                </Link>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2.5 text-sm font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={emailApprovalEnabled}
                  onChange={(e) => setEmailApprovalEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-input accent-blue-600"
                />
                M&apos;envoyer chaque candidature préparée par email pour
                validation (avec Lettre PDF jointe)
              </label>

              <label className="flex items-center gap-2.5 text-sm font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoSendOnEmailApproval}
                  onChange={(e) => setAutoSendOnEmailApproval(e.target.checked)}
                  className="h-4 w-4 rounded border-input accent-blue-600"
                />
                Envoyer directement au recruteur depuis ma boîte connectée dès
                mon clic sur « Approuver &amp; Envoyer »
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div className="space-y-1.5 md:col-span-2">
                <Label>
                  Votre adresse email de réception pour valider les candidatures
                </Label>
                <Input
                  type="email"
                  placeholder="votre.nom@gmail.com"
                  value={approvalEmailRecipient}
                  onChange={(e) => setApprovalEmailRecipient(e.target.value)}
                />
              </div>

              <div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={testingEmailApproval}
                  onClick={handleTestEmailApproval}
                >
                  {testingEmailApproval ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Tester l&apos;Email de Validation
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Button type="submit" disabled={saving}>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Enregistrer les règles d&apos;automatisation &amp; Validation Email
        </Button>
      </form>

      {/* Recent Email Approvals */}
      {emailApprovals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Historique des Validations par Email
            </CardTitle>
            <CardDescription>
              Emails de validation envoyés et statut d&apos;approbation
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {emailApprovals.map((em) => (
              <div
                key={em.id}
                className="rounded-xl border p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant={
                      em.status === "approved"
                        ? "success"
                        : em.status === "rejected" ||
                            em.status === "invalidated"
                          ? "destructive"
                          : "warning"
                    }
                  >
                    {em.status}
                  </Badge>
                  <span className="font-mono font-semibold">
                    #{em.approval_code}
                  </span>
                  <span className="text-muted-foreground">
                    {em.approver_email}
                  </span>
                </div>
                <span className="text-muted-foreground">
                  {formatShortDate(em.created_at)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Automation Run History */}
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
