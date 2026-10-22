"use client";

import React, { useEffect, useState } from "react";
import {
  Bot,
  CalendarClock,
  CheckCircle2,
  Clock,
  Copy,
  Loader2,
  MessageSquareShare,
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

  // Kapso WhatsApp settings
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [whatsappPhone, setWhatsappPhone] = useState("");
  const [autoSendOnWhatsAppApproval, setAutoSendOnWhatsAppApproval] =
    useState(true);
  const [kapsoStatus, setKapsoStatus] = useState<{
    configured: boolean;
    webhookSecretConfigured: boolean;
  } | null>(null);
  const [connectedKapsoSender, setConnectedKapsoSender] = useState<{
    phoneNumberId: string;
    displayPhoneNumber: string | null;
  } | null>(null);
  const [kapsoWaMeLink, setKapsoWaMeLink] = useState<string | null>(null);
  const [sessionWindowWarning, setSessionWindowWarning] = useState<
    string | null
  >(null);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [whatsappApprovals, setWhatsappApprovals] = useState<Array<any>>([]);
  const [testingWhatsApp, setTestingWhatsApp] = useState(false);

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
        setMaxDrafts(s.max_drafts_per_run ?? 5);
        setAiProvider(s.ai_provider ?? "groq");
        setEmailLanguage(s.email_language ?? "auto");
        setNotifyInApp(s.notify_in_app ?? true);
        setWhatsappEnabled(Boolean(s.whatsapp_enabled));
        setWhatsappPhone(s.whatsapp_phone_number ?? "");
        setAutoSendOnWhatsAppApproval(
          s.auto_send_on_whatsapp_approval !== false
        );
        setRuns(d.runs ?? []);
        setWhatsappApprovals(d.whatsappApprovals ?? []);
        setKapsoStatus(d.kapso ?? null);

        // Pre-fill recipient phone from profile if empty, and inspect connected Kapso sender
        const [profRes, kapsoRes] = await Promise.all([
          !s.whatsapp_phone_number
            ? fetch("/api/profile").catch(() => null)
            : Promise.resolve(null),
          d.kapso?.configured
            ? fetch("/api/whatsapp/kapso/test").catch(() => null)
            : Promise.resolve(null),
        ]);
        if (profRes && profRes.ok) {
          const pd = await profRes.json();
          if (pd.profile?.phone) {
            setWhatsappPhone(pd.profile.phone);
          }
        }
        if (kapsoRes && kapsoRes.ok) {
          const kd = await kapsoRes.json();
          if (kd.connectedNumber) {
            setConnectedKapsoSender(kd.connectedNumber);
          }
          if (kd.waMeLink) {
            setKapsoWaMeLink(kd.waMeLink);
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
          schedule_mode: scheduleMode,
          scheduled_date:
            scheduleMode === "specific_date" ? scheduledDate : null,
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
          whatsapp_enabled: whatsappEnabled,
          whatsapp_phone_number: whatsappPhone.trim(),
          auto_send_on_whatsapp_approval: autoSendOnWhatsAppApproval,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Could not save automation settings.");
        return;
      }
      toast.success(
        "Paramètres d'automatisation et WhatsApp (Kapso) enregistrés !"
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
        toast.error(data.error || "Automation run failed.");
        return;
      }
      if (data.status === "skipped_locked") {
        toast.warning(data.errorMessage || "A run is already in progress.");
        return;
      }
      toast.success(
        `Automation complete: ${data.jobsDiscovered} jobs scanned, ${data.jobsMatched} matched, ${data.draftsGenerated} drafts prepared.`
      );
      await loadAutomation();
    } finally {
      setRunningNow(false);
    }
  }

  async function handleTestWhatsApp() {
    if (!whatsappPhone.trim()) {
      toast.error("Saisissez votre numéro WhatsApp (ex: +212612345678).");
      return;
    }
    setTestingWhatsApp(true);
    setSessionWindowWarning(null);
    try {
      const res = await fetch("/api/whatsapp/kapso/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: whatsappPhone.trim() }),
      });
      const data = await res.json();
      if (data.waMeLink) {
        setKapsoWaMeLink(data.waMeLink);
      }
      if (data.connectedNumber) {
        setConnectedKapsoSender(data.connectedNumber);
      }
      if (!res.ok) {
        if (data.requiresSessionWindow) {
          setSessionWindowWarning(data.error);
        }
        toast.error(data.error || "Kapso WhatsApp test failed.");
        return;
      }
      toast.success(
        data.note
          ? `Message WhatsApp envoyé (${data.phone}) ! ${data.note}`
          : `Message test envoyé sur WhatsApp (${data.phone}) via Kapso !`
      );
    } finally {
      setTestingWhatsApp(false);
    }
  }

  async function handleCreateUtilityTemplate() {
    setCreatingTemplate(true);
    try {
      const res = await fetch("/api/whatsapp/kapso/template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "fr" }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Échec de soumission du modèle Meta.");
        return;
      }
      toast.success(
        `Modèle Meta « ${data.template?.name} » soumis (${data.template?.status}) !`
      );
    } finally {
      setCreatingTemplate(false);
    }
  }

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/whatsapp/kapso/webhook`
      : "https://jobhunterai-five.vercel.app/api/whatsapp/kapso/webhook";

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">
            Cloud Automation &amp; Kapso WhatsApp Approval
          </h2>
          <p className="text-sm text-muted-foreground">
            Automatisez vos postulations <strong>chaque jour</strong> ou{" "}
            <strong>un jour précis</strong> : l&apos;IA génère le mail + Lettre de
            Motivation PDF, vous envoie tout sur WhatsApp via{" "}
            <strong>Kapso</strong>, et expédie l&apos;email depuis votre boîte
            connectée dès votre approbation.
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
          email n&apos;est envoyé sans votre clic explicite sur{" "}
          <strong>Approuver &amp; Envoyer</strong> (sur WhatsApp via Kapso avec
          signature HMAC-SHA256 + hash SHA-256 du contenu, ou dans Approval
          Queue).
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
                Loading settings...
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
                    Inclure le Télétravail / Remote
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

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label>Fréquence d&apos;automatisation</Label>
                    <select
                      value={scheduleMode}
                      onChange={(e) => setScheduleMode(e.target.value as any)}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    >
                      <option value="daily">
                        Chaque jour (Quotidien 07:00 UTC)
                      </option>
                      <option value="specific_date">
                        Un jour précis (Date exacte)
                      </option>
                      <option value="manual_only">
                        Manuel uniquement (depuis Find Jobs)
                      </option>
                    </select>
                  </div>

                  {scheduleMode === "specific_date" && (
                    <div className="space-y-1.5">
                      <Label className="flex items-center gap-1.5">
                        <CalendarClock className="h-3.5 w-3.5 text-primary" />
                        Date précise d&apos;exécution
                      </Label>
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
                      <option value="auto">Auto-détection (FR / EN)</option>
                      <option value="fr">Français (FR)</option>
                      <option value="en">Anglais (EN)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Fournisseur IA Principal</Label>
                    <select
                      value={aiProvider}
                      onChange={(e) => setAiProvider(e.target.value as any)}
                      className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                    >
                      <option value="groq">Groq Cloud (Défaut)</option>
                      <option value="gemini">Google Gemini</option>
                      <option value="xai">xAI Grok</option>
                    </select>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Card 2: Kapso WhatsApp Approval -> Direct User Email Dispatch */}
        <Card className="border-violet-500/40">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <MessageSquareShare className="h-4 w-4 text-violet-600" />
                  2. Validation WhatsApp via Kapso &rarr; Envoi Email Direct
                </CardTitle>
                <CardDescription>
                  Recevez sur WhatsApp la Lettre de Motivation PDF + aperçu du
                  mail avec les boutons <strong>Approuver &amp; Envoyer</strong>{" "}
                  et <strong>Refuser</strong>
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge
                  variant={kapsoStatus?.configured ? "success" : "warning"}
                >
                  Kapso API:{" "}
                  {kapsoStatus?.configured
                    ? connectedKapsoSender?.displayPhoneNumber
                      ? `Connecté (${connectedKapsoSender.displayPhoneNumber})`
                      : "Connecté (auto phone_number_id)"
                    : "Requiert KAPSO_API_KEY"}
                </Badge>
                <Badge
                  variant={
                    kapsoStatus?.webhookSecretConfigured ? "success" : "warning"
                  }
                >
                  Webhook HMAC:{" "}
                  {kapsoStatus?.webhookSecretConfigured
                    ? "Actif"
                    : "Requiert KAPSO_WEBHOOK_SECRET"}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2.5 text-sm font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={whatsappEnabled}
                  onChange={(e) => setWhatsappEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-input accent-violet-600"
                />
                Envoyer les candidatures préparées sur mon WhatsApp (Kapso)
              </label>

              <label className="flex items-center gap-2.5 text-sm font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoSendOnWhatsAppApproval}
                  onChange={(e) =>
                    setAutoSendOnWhatsAppApproval(e.target.checked)
                  }
                  className="h-4 w-4 rounded border-input accent-violet-600"
                />
                Envoyer directement depuis mon email connecté dès mon
                approbation sur WhatsApp
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div className="space-y-1.5">
                <Label>Votre numéro WhatsApp (format international)</Label>
                <Input
                  placeholder="+212612345678"
                  value={whatsappPhone}
                  onChange={(e) => setWhatsappPhone(e.target.value)}
                />
              </div>

              <div className="md:col-span-2 flex flex-wrap gap-2">
                {kapsoWaMeLink ? (
                  <a
                    href={kapsoWaMeLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3.5 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors"
                  >
                    1. Envoyer « Bonjour » au numéro Kapso (Session 24h)
                  </a>
                ) : null}

                <Button
                  type="button"
                  variant="outline"
                  disabled={testingWhatsApp}
                  onClick={handleTestWhatsApp}
                >
                  {testingWhatsApp ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {kapsoWaMeLink
                    ? "2. Tester WhatsApp (Kapso)"
                    : "Tester WhatsApp (Kapso)"}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={creatingTemplate}
                  onClick={handleCreateUtilityTemplate}
                  className="text-xs"
                >
                  {creatingTemplate ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Créer modèle Utility Meta (hors 24h)
                </Button>
              </div>
            </div>

            {sessionWindowWarning ? (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-amber-950 dark:text-amber-200 space-y-2">
                <p className="font-semibold">{sessionWindowWarning}</p>
                {kapsoWaMeLink ? (
                  <p>
                    👉{" "}
                    <a
                      href={kapsoWaMeLink}
                      target="_blank"
                      rel="noreferrer"
                      className="underline font-semibold"
                    >
                      Cliquez ici pour ouvrir WhatsApp vers{" "}
                      {connectedKapsoSender?.displayPhoneNumber ||
                        "votre numéro Kapso"}{" "}
                      et envoyer « Bonjour »
                    </a>
                    , puis recliquez immédiatement sur{" "}
                    <strong>Tester WhatsApp (Kapso)</strong>.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-xl border bg-muted/40 p-3.5 text-xs space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">
                  URL Webhook à configurer dans Kapso Dashboard (événement{" "}
                  <code>whatsapp.message.received</code>) :
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    navigator.clipboard?.writeText(webhookUrl);
                    toast.success("URL Webhook Kapso copiée !");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copier l&apos;URL
                </Button>
              </div>
              <code className="block rounded bg-background px-2.5 py-1.5 text-[11px] break-all border">
                {webhookUrl}
              </code>
            </div>
          </CardContent>
        </Card>

        <Button type="submit" disabled={saving}>
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Enregistrer les règles d&apos;automatisation &amp; WhatsApp
        </Button>
      </form>

      {/* Recent WhatsApp Approvals */}
      {whatsappApprovals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Historique des Validations WhatsApp (Kapso)
            </CardTitle>
            <CardDescription>
              Suivi des codes d&apos;approbation envoyés et des emails expédiés
              après validation
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {whatsappApprovals.map((wa) => (
              <div
                key={wa.id}
                className="rounded-xl border p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant={
                      wa.status === "approved_and_sent"
                        ? "success"
                        : wa.status === "rejected" || wa.status === "failed"
                          ? "destructive"
                          : "warning"
                    }
                  >
                    {wa.status}
                  </Badge>
                  <span className="font-mono font-semibold">
                    #{wa.approval_code}
                  </span>
                  <span className="text-muted-foreground">
                    +{wa.recipient_phone}
                  </span>
                  {wa.error_message && (
                    <span className="text-destructive">
                      • {wa.error_message}
                    </span>
                  )}
                </div>
                <span className="text-muted-foreground">
                  {formatShortDate(wa.created_at)}
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
