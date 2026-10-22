"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bookmark,
  CalendarClock,
  CheckSquare,
  ExternalLink,
  Globe,
  Linkedin,
  Loader2,
  MapPin,
  MessageSquareShare,
  PlusCircle,
  Search,
  Sparkles,
  Square,
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
import { formatRelativeDate, scoreColorClasses } from "@/lib/utils";
import { matchesSelectedLocations } from "@/lib/jobs/location-filter";
import { toast } from "sonner";

const REGION_PRESETS = ["Morocco", "France", "Europe", "Remote", "International"];

interface LinkedInPreset {
  id: string;
  label: string;
  badge: string;
  keywords: string;
  locationLabel: string;
  timeFilterLabel: string;
  url: string;
  matchedFrom: string[];
}

export default function FindJobsPage() {
  const [jobs, setJobs] = useState<Array<any>>([]);
  const [query, setQuery] = useState("");
  const [locations, setLocations] = useState<string[]>(["Morocco"]);
  const [remotePref, setRemotePref] = useState<string>("any");
  const [languageFilter, setLanguageFilter] = useState<string>("any");
  const [contractType, setContractType] = useState<string>("any");
  const [savedOnly, setSavedOnly] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [sourceReports, setSourceReports] = useState<Array<any>>([]);

  // LinkedIn profile-matched search + import state
  const [showLinkedInPanel, setShowLinkedInPanel] = useState(false);
  const [linkedInPresets, setLinkedInPresets] = useState<LinkedInPreset[]>([]);
  const [profileSummary, setProfileSummary] = useState<any>(null);
  const [importUrl, setImportUrl] = useState("");
  const [importTitle, setImportTitle] = useState("");
  const [importCompany, setImportCompany] = useState("");
  const [importLocation, setImportLocation] = useState("Casablanca, Morocco");
  const [importEmail, setImportEmail] = useState("");
  const [importDescription, setImportDescription] = useState("");
  const [previewingUrl, setPreviewingUrl] = useState(false);
  const [importingOffer, setImportingOffer] = useState(false);

  // Multi-select batch automation + Email Approval state
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [executionTiming, setExecutionTiming] = useState<
    "now" | "daily" | "specific_date"
  >("now");
  const [scheduledDate, setScheduledDate] = useState<string>(() => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return tomorrow.toISOString().slice(0, 10);
  });
  const [sendEmailApproval, setSendEmailApproval] = useState(true);
  const [approverEmail, setApproverEmail] = useState("");
  const [batchRunning, setBatchRunning] = useState(false);

  async function loadJobs(activeLocs: string[] = locations) {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (activeLocs.length > 0) {
        qs.set("locations", activeLocs.join(","));
      }
      const res = await fetch(`/api/jobs?${qs.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadLinkedInPresets(activeLocs: string[] = locations) {
    try {
      const qs = new URLSearchParams();
      if (activeLocs.length > 0) {
        qs.set("locations", activeLocs.join(","));
      }
      const res = await fetch(`/api/jobs/linkedin?${qs.toString()}`);
      if (res.ok) {
        const d = await res.json();
        setLinkedInPresets(d.presets ?? []);
        setProfileSummary(d.profileSummary ?? null);
      }
    } catch {
      // Non-blocking
    }
  }

  async function loadAutomationDefaults() {
    try {
      const res = await fetch("/api/automation");
      if (res.ok) {
        const d = await res.json();
        const emailFromSettings =
          d.settings?.approval_email_recipient ||
          d.emailConnection?.email_address ||
          "";
        if (emailFromSettings) {
          setApproverEmail(emailFromSettings);
        }
        if (
          Array.isArray(d.settings?.search_locations) &&
          d.settings.search_locations.length > 0
        ) {
          setLocations(d.settings.search_locations);
          await Promise.all([
            loadJobs(d.settings.search_locations),
            loadLinkedInPresets(d.settings.search_locations),
          ]);
          return;
        }
      }
    } catch {
      // Non-blocking
    }
    await Promise.all([loadJobs(locations), loadLinkedInPresets(locations)]);
  }

  useEffect(() => {
    loadAutomationDefaults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleLocation(loc: string) {
    setLocations((prev) => {
      const next = prev.includes(loc)
        ? prev.filter((x) => x !== loc)
        : [...prev, loc];
      const effective = next.length > 0 ? next : ["Morocco"];
      loadJobs(effective);
      loadLinkedInPresets(effective);
      return effective;
    });
  }

  function selectMoroccoStrictly() {
    const strict = ["Morocco"];
    setLocations(strict);
    setRemotePref("any");
    loadJobs(strict);
    loadLinkedInPresets(strict);
    toast.success(
      "Filtre strict Maroc activé : seules les offres situées au Maroc seront recherchées et affichées."
    );
  }

  async function handleDiscover(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setDiscovering(true);
    try {
      const res = await fetch("/api/jobs/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: query.trim() || undefined,
          locations,
          remotePreference: remotePref,
          contractType,
          language: languageFilter,
          limit: 40,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Job discovery failed.");
        return;
      }
      setSourceReports(data.sourceReports ?? []);
      await loadJobs(locations);
      toast.success(
        `Discovered ${data.insertedOrUpdatedCount} strictly matching offers (${data.duplicatesRemoved} duplicates removed).`
      );
    } finally {
      setDiscovering(false);
    }
  }

  async function handlePreviewLinkedInUrl() {
    if (!importUrl.trim()) {
      toast.error("Paste a public LinkedIn or company job URL first.");
      return;
    }
    setPreviewingUrl(true);
    try {
      const res = await fetch("/api/jobs/linkedin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "preview_url",
          url: importUrl.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Could not preview URL.");
        return;
      }
      const p = data.preview;
      if (p?.canonical_url) setImportUrl(p.canonical_url);
      if (p?.title) setImportTitle(p.title);
      if (p?.company_name) setImportCompany(p.company_name);
      if (p?.location) setImportLocation(p.location);
      if (p?.description) setImportDescription(p.description);

      if (p?.reachable && p?.title) {
        toast.success("Public offer metadata extracted! Review and click Import & Score.");
      } else {
        toast.info(
          p?.note ||
            "LinkedIn requires manual paste for full description — fill Title, Company & Description below."
        );
      }
    } finally {
      setPreviewingUrl(false);
    }
  }

  async function handleImportLinkedInOffer(e: React.FormEvent) {
    e.preventDefault();
    if (!importUrl.trim() || !importTitle.trim() || !importCompany.trim()) {
      toast.error("Provide the Job URL, Position Title, and Company Name.");
      return;
    }
    setImportingOffer(true);
    try {
      const res = await fetch("/api/jobs/linkedin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import",
          offers: [
            {
              url: importUrl.trim(),
              title: importTitle.trim(),
              company_name: importCompany.trim(),
              location: importLocation.trim() || "Casablanca, Morocco",
              description: importDescription.trim(),
              public_recruitment_email: importEmail.trim() || null,
              is_remote: /remote|télétravail/i.test(importLocation),
            },
          ],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Import failed.");
        return;
      }
      const newJob = data.jobs?.[0];
      if (newJob) {
        setSelectedJobIds((prev) =>
          prev.includes(newJob.id) ? prev : [...prev, newJob.id].slice(0, 10)
        );
      }
      setImportUrl("");
      setImportTitle("");
      setImportCompany("");
      setImportEmail("");
      setImportDescription("");
      await loadJobs(locations);
      toast.success(
        `Offer imported & scored (${newJob?.match?.match_score ?? 0}% match) and selected for batch automation!`
      );
    } finally {
      setImportingOffer(false);
    }
  }

  async function toggleSaved(job: any) {
    const nextVal = !job.is_saved;
    setJobs((prev) =>
      prev.map((j) => (j.id === job.id ? { ...j, is_saved: nextVal } : j))
    );
    await fetch("/api/jobs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: job.id, is_saved: nextVal }),
    });
  }

  function toggleJobSelected(jobId: string) {
    setSelectedJobIds((prev) => {
      if (prev.includes(jobId)) {
        return prev.filter((id) => id !== jobId);
      }
      if (prev.length >= 10) {
        toast.warning("Select up to 10 offers per automated batch.");
        return prev;
      }
      return [...prev, jobId];
    });
  }

  const displayedJobs = jobs.filter((j) => {
    if (!matchesSelectedLocations(j, locations)) return false;
    if (savedOnly && !j.is_saved) return false;
    if (languageFilter !== "any" && j.detected_language !== languageFilter) {
      return false;
    }
    if (remotePref === "remote_only" && !j.is_remote) return false;
    if (remotePref === "onsite" && j.is_remote) return false;
    if (filterText.trim()) {
      const hay = `${j.title} ${j.company_name} ${j.location} ${(
        j.required_skills ?? []
      ).join(" ")}`.toLowerCase();
      if (!hay.includes(filterText.trim().toLowerCase())) return false;
    }
    return true;
  });

  function selectTopFiveVisible() {
    const topIds = displayedJobs.slice(0, 5).map((j) => j.id);
    if (topIds.length === 0) {
      toast.info("Discover or import offers first to select the Top 5.");
      return;
    }
    setSelectedJobIds(topIds);
    toast.success(`Selected Top ${topIds.length} offers for automated preparation!`);
  }

  async function handleRunBatchAutomation() {
    if (selectedJobIds.length === 0) {
      toast.error("Select at least 1 job offer first.");
      return;
    }

    setBatchRunning(true);
    try {
      const res = await fetch("/api/applications/batch-automate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobIds: selectedJobIds,
          executionTiming,
          scheduledDate:
            executionTiming === "specific_date" ? scheduledDate : null,
          sendEmailApproval,
          approverEmail: approverEmail.trim() || undefined,
          languageOverride:
            languageFilter === "fr" || languageFilter === "en"
              ? languageFilter
              : "auto",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Batch automation failed.");
        return;
      }

      if (data.scheduledForDate) {
        toast.success(
          `✅ ${data.preparedCount} candidatures (mail + PDF) générées et programmées pour validation par email le ${data.scheduledForDate} !`
        );
      } else if (data.emailApprovalSentCount > 0) {
        toast.success(
          `🚀 ${data.preparedCount} candidatures préparées et ${data.emailApprovalSentCount} envoyées dans votre boîte email pour validation !`
        );
      } else {
        const firstNote = data.prepared?.find(
          (p: any) => p.emailApprovalNote
        )?.emailApprovalNote;
        toast.success(
          `✅ ${data.preparedCount} candidatures générées dans Approval Queue.${
            firstNote ? ` (${firstNote})` : ""
          }`
        );
      }
      setSelectedJobIds([]);
    } finally {
      setBatchRunning(false);
    }
  }

  const isStrictMoroccoOnly =
    locations.length === 1 && locations[0].toLowerCase() === "morocco";

  return (
    <div className="space-y-6">
      {/* Discovery Search Engine */}
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">
                Smart Job Discovery & LinkedIn Profile Search
              </CardTitle>
              <CardDescription>
                Strict regional filtering (e.g., Morocco-only excludes France &
                other countries), LinkedIn searches matched to your saved CV, and
                batch Email Approval automation
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={isStrictMoroccoOnly ? "default" : "outline"}
                size="sm"
                onClick={selectMoroccoStrictly}
              >
                🇲🇦 Maroc Uniquement
              </Button>
              <Button
                type="button"
                variant={showLinkedInPanel ? "default" : "outline"}
                size="sm"
                onClick={() => setShowLinkedInPanel((v) => !v)}
              >
                <Linkedin className="h-3.5 w-3.5" />
                LinkedIn (Profil CV)
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleDiscover} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 space-y-1.5">
                <Label htmlFor="q">Role, Technology, or Keyword</Label>
                <Input
                  id="q"
                  placeholder="e.g., Full Stack Engineer, Data Scientist, DevOps, Stage PFE..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="remotePref">Work Arrangement</Label>
                <select
                  id="remotePref"
                  value={remotePref}
                  onChange={(e) => setRemotePref(e.target.value)}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                >
                  <option value="any">Any (On-site / Hybrid / Remote)</option>
                  <option value="onsite">On-site Only</option>
                  <option value="remote_only">Remote Only</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Strict Target Regions (only selected regions are fetched & shown)
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {REGION_PRESETS.map((reg) => {
                    const active = locations.includes(reg);
                    return (
                      <button
                        key={reg}
                        type="button"
                        onClick={() => toggleLocation(reg)}
                        className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {reg}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={languageFilter}
                  onChange={(e) => setLanguageFilter(e.target.value)}
                  className="h-9 rounded-lg border border-input bg-background px-2.5 text-xs"
                >
                  <option value="any">All Languages (FR/EN)</option>
                  <option value="fr">French (FR)</option>
                  <option value="en">English (EN)</option>
                </select>

                <select
                  value={contractType}
                  onChange={(e) => setContractType(e.target.value)}
                  className="h-9 rounded-lg border border-input bg-background px-2.5 text-xs"
                >
                  <option value="any">All Contracts</option>
                  <option value="full_time">Full-Time / CDI</option>
                  <option value="contract">Contract / Freelance</option>
                  <option value="internship">Internship / Stage</option>
                </select>

                <Button type="submit" disabled={discovering}>
                  {discovering ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {discovering ? "Searching Feeds..." : "Discover Live Jobs"}
                </Button>
              </div>
            </div>
          </form>

          {/* Source Diagnostics */}
          {sourceReports.length > 0 && (
            <div className="mt-4 pt-4 border-t flex flex-wrap gap-2">
              {sourceReports.map((sr) => (
                <Badge
                  key={sr.source}
                  variant={
                    sr.status === "ok"
                      ? "success"
                      : sr.status === "requires_configuration"
                        ? "warning"
                        : "outline"
                  }
                  title={sr.message || ""}
                >
                  {sr.source}: {sr.count} jobs
                  {sr.status === "requires_configuration"
                    ? " (API key optional)"
                    : ""}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* LinkedIn Profile-Matched Search & 1-Click Offer Import */}
      {showLinkedInPanel && (
        <Card className="border-blue-500/40 bg-blue-500/[0.03]">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Linkedin className="h-4 w-4 text-blue-600" />
              LinkedIn Jobs — Aligné avec votre Profil enregistré & Import Rapide
            </CardTitle>
            <CardDescription>
              Recherches LinkedIn pré-filtrées selon votre CV enregistré
              {profileSummary?.professional_title
                ? ` (${profileSummary.professional_title})`
                : ""}{" "}
              et vos régions sélectionnées ({locations.join(", ")}), sans scraping
              interdit. Importez vos offres choisies pour les scorer et recevoir
              les candidatures par email pour validation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {linkedInPresets.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs">
                  1. Ouvrir vos recherches LinkedIn personnalisées (selon votre CV)
                </Label>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {linkedInPresets.map((preset) => (
                    <a
                      key={preset.id}
                      href={preset.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl border bg-background p-3 hover:border-blue-500/60 transition-colors flex flex-col justify-between gap-2"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant="secondary" className="text-[10px]">
                            {preset.badge}
                          </Badge>
                          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                        <p className="text-xs font-semibold line-clamp-2">
                          {preset.label}
                        </p>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {preset.timeFilterLabel} • Basé sur:{" "}
                        {preset.matchedFrom.join(", ")}
                      </p>
                    </a>
                  ))}
                </div>
              </div>
            )}

            <form
              onSubmit={handleImportLinkedInOffer}
              className="rounded-xl border bg-background p-4 space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <Label className="text-xs font-semibold">
                  2. Importer une offre LinkedIn ou Carrières pour postulation
                  automatisée
                </Label>
                <span className="text-[11px] text-muted-foreground">
                  Calcule le score 0–100% et l&apos;ajoute à votre sélection
                </span>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  placeholder="https://www.linkedin.com/jobs/view/... ou URL carrière officielle"
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={previewingUrl}
                  onClick={handlePreviewLinkedInUrl}
                  className="shrink-0"
                >
                  {previewingUrl ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Auto-remplir depuis l&apos;URL
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <Input
                  placeholder="Titre du poste (ex: Full Stack Engineer)"
                  value={importTitle}
                  onChange={(e) => setImportTitle(e.target.value)}
                />
                <Input
                  placeholder="Entreprise (ex: OCP, Yassir, SQLI)"
                  value={importCompany}
                  onChange={(e) => setImportCompany(e.target.value)}
                />
                <Input
                  placeholder="Ville / Pays (ex: Casablanca, Morocco)"
                  value={importLocation}
                  onChange={(e) => setImportLocation(e.target.value)}
                />
                <Input
                  placeholder="Email RH publié (optionnel)"
                  value={importEmail}
                  onChange={(e) => setImportEmail(e.target.value)}
                />
              </div>

              <Textarea
                rows={3}
                placeholder="Collez la description de l'offre ici pour personnaliser le mail, la lettre de motivation PDF et le score IA..."
                value={importDescription}
                onChange={(e) => setImportDescription(e.target.value)}
              />

              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={importingOffer}>
                  {importingOffer ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <PlusCircle className="h-4 w-4" />
                  )}
                  Importer, Scorer & Sélectionner
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Batch Automation + Email Approval Bar */}
      <Card className="border-blue-500/40 bg-blue-500/[0.04]">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <MessageSquareShare className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-semibold">
                  Postulation Automatisée en Lot + Validation par Email
                </span>
                <Badge variant="secondary">
                  {selectedJobIds.length} offre(s) sélectionnée(s)
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Sélectionnez p.ex. 5 offres : l&apos;IA prépare le mail + Lettre de
                Motivation PDF, vous les envoie dans votre boîte email avec les
                boutons <strong>Approuver &amp; Envoyer</strong> /{" "}
                <strong>Refuser</strong>, et expédie l&apos;email au recruteur dès
                votre validation.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={selectTopFiveVisible}
              >
                <CheckSquare className="h-3.5 w-3.5" />
                Sélectionner le Top 5
              </Button>
              {selectedJobIds.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedJobIds([])}
                >
                  Effacer ({selectedJobIds.length})
                </Button>
              )}
            </div>
          </div>

          {selectedJobIds.length > 0 && (
            <div className="pt-3 border-t grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Mode de planification</Label>
                <select
                  value={executionTiming}
                  onChange={(e) => setExecutionTiming(e.target.value as any)}
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-2.5 text-xs"
                >
                  <option value="now">
                    Immédiat (Préparer &amp; envoyer par Email pour validation)
                  </option>
                  <option value="daily">
                    Chaque jour (Activer le lot quotidien 07:00 UTC)
                  </option>
                  <option value="specific_date">
                    Un jour précis (Programmer à une date exacte)
                  </option>
                </select>
              </div>

              {executionTiming === "specific_date" && (
                <div className="space-y-1">
                  <Label className="text-xs flex items-center gap-1">
                    <CalendarClock className="h-3.5 w-3.5" />
                    Jour précis d&apos;envoi par Email
                  </Label>
                  <Input
                    type="date"
                    value={scheduledDate}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={sendEmailApproval}
                    onChange={(e) => setSendEmailApproval(e.target.checked)}
                    className="h-3.5 w-3.5 accent-blue-600"
                  />
                  Email de validation
                </Label>
                <Input
                  type="email"
                  placeholder="votre.nom@gmail.com (auto)"
                  value={approverEmail}
                  disabled={!sendEmailApproval}
                  onChange={(e) => setApproverEmail(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div>
                <Button
                  type="button"
                  onClick={handleRunBatchAutomation}
                  disabled={batchRunning}
                  className="w-full"
                >
                  {batchRunning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {batchRunning
                    ? "Préparation IA en cours..."
                    : `Automatiser ces ${selectedJobIds.length} offre(s)`}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative max-w-sm w-full">
          <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
          <Input
            placeholder="Filter discovered jobs..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={savedOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setSavedOnly((v) => !v)}
          >
            <Bookmark className="h-3.5 w-3.5" />
            Saved ({jobs.filter((j) => j.is_saved).length})
          </Button>
          <span className="text-xs text-muted-foreground">
            Showing {displayedJobs.length} listings in [{locations.join(", ")}]
          </span>
        </div>
      </div>

      {/* Job Cards */}
      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          Loading saved opportunities...
        </div>
      ) : displayedJobs.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center space-y-3">
            <Globe className="h-9 w-9 text-primary mx-auto" />
            <h3 className="font-semibold text-base">
              No discovered jobs in [{locations.join(", ")}] yet
            </h3>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Click <strong>Discover Live Jobs</strong> above to fetch verified
              openings strictly matching{" "}
              <strong>{locations.join(", ")}</strong>, or open{" "}
              <strong>LinkedIn (Profil CV)</strong> to import offers.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {displayedJobs.map((job) => {
            const isSelected = selectedJobIds.includes(job.id);
            return (
              <Card
                key={job.id}
                className={`transition-colors ${
                  isSelected
                    ? "border-violet-500 bg-violet-500/[0.03]"
                    : "hover:border-primary/40"
                }`}
              >
                <CardContent className="p-5 space-y-3">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => toggleJobSelected(job.id)}
                        className="mt-1 text-muted-foreground hover:text-primary"
                        title="Select offer for batch Email Approval automation"
                      >
                        {isSelected ? (
                          <CheckSquare className="h-5 w-5 text-violet-600" />
                        ) : (
                          <Square className="h-5 w-5" />
                        )}
                      </button>

                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-base">{job.title}</h3>
                          {job.match && (
                            <Badge
                              className={scoreColorClasses(job.match.match_score)}
                            >
                              Match Score: {job.match.match_score}%
                            </Badge>
                          )}
                          <Badge variant="outline">
                            {job.detected_language === "fr" ? "FR" : "EN"}
                          </Badge>
                          {job.is_remote && (
                            <Badge variant="secondary">Remote</Badge>
                          )}
                          {job.source === "linkedin_import" && (
                            <Badge className="bg-blue-600 text-white">
                              LinkedIn
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm font-medium text-foreground/90">
                          {job.company_name}
                        </p>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {job.location}
                          </span>
                          <span>• {job.sector}</span>
                          <span>• Source: {job.source}</span>
                          {job.salary_text && <span>• {job.salary_text}</span>}
                          {job.published_at && (
                            <span>
                              • Published {formatRelativeDate(job.published_at)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleSaved(job)}
                        title="Bookmark job"
                      >
                        <Bookmark
                          className={`h-4 w-4 ${
                            job.is_saved
                              ? "fill-primary text-primary"
                              : "text-muted-foreground"
                          }`}
                        />
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <a
                          href={job.application_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Official Link
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                      <Button size="sm" asChild>
                        <Link href={`/generator?jobId=${job.id}`}>
                          <Wand2 className="h-3.5 w-3.5" />
                          Generate Application
                        </Link>
                      </Button>
                    </div>
                  </div>

                  {(job.required_skills ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pl-8">
                      {job.required_skills.slice(0, 10).map((sk: string) => (
                        <Badge
                          key={sk}
                          variant="secondary"
                          className="text-[11px]"
                        >
                          {sk}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {job.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 pl-8">
                      {job.description}
                    </p>
                  )}

                  {job.public_recruitment_email && (
                    <p className="text-xs text-emerald-700 dark:text-emerald-300 font-medium pl-8">
                      Verified published contact: {job.public_recruitment_email}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
