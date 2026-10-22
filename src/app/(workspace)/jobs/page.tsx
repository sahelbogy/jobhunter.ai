"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bookmark,
  ExternalLink,
  Globe,
  Loader2,
  MapPin,
  Search,
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
import { Badge, Input, Label } from "@/components/ui/primitives";
import { formatRelativeDate, scoreColorClasses } from "@/lib/utils";
import { toast } from "sonner";

const REGION_OPTIONS = [
  "Morocco",
  "France",
  "Europe",
  "International",
  "Remote",
];

export default function FindJobsPage() {
  const [jobs, setJobs] = useState<Array<any>>([]);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [sourceReports, setSourceReports] = useState<Array<any>>([]);

  // Discovery search form
  const [query, setQuery] = useState("");
  const [locations, setLocations] = useState<string[]>([
    "Morocco",
    "France",
    "Europe",
    "Remote",
  ]);
  const [remotePref, setRemotePref] = useState<
    "any" | "remote_only" | "hybrid" | "onsite"
  >("any");
  const [contractType, setContractType] = useState("any");
  const [language, setLanguage] = useState<"any" | "fr" | "en">("any");
  const [sector, setSector] = useState("any");

  // Local filter on persisted jobs
  const [filterText, setFilterText] = useState("");
  const [savedOnly, setSavedOnly] = useState(false);

  async function loadSavedJobs() {
    setLoading(true);
    try {
      const res = await fetch("/api/jobs");
      if (res.ok) {
        const d = await res.json();
        setJobs(d.jobs ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSavedJobs();
  }, []);

  async function handleDiscover(e?: React.FormEvent) {
    e?.preventDefault();
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
          language,
          sector: sector === "any" ? undefined : sector,
          limit: 40,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Job discovery failed.");
        return;
      }

      setSourceReports(data.sourceReports ?? []);
      toast.success(
        `Discovered ${data.insertedOrUpdatedCount} verified opportunities (${data.duplicatesRemoved} duplicates removed).`
      );
      await loadSavedJobs();
    } catch {
      toast.error("Network error during live job discovery.");
    } finally {
      setDiscovering(false);
    }
  }

  async function toggleSaved(job: any) {
    const next = !job.is_saved;
    setJobs((prev) =>
      prev.map((j) => (j.id === job.id ? { ...j, is_saved: next } : j))
    );
    await fetch("/api/jobs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: job.id, is_saved: next }),
    });
  }

  const displayedJobs = jobs.filter((j) => {
    if (savedOnly && !j.is_saved) return false;
    if (filterText.trim()) {
      const q = filterText.trim().toLowerCase();
      const hay = `${j.title} ${j.company_name} ${j.location} ${j.sector} ${(
        j.required_skills ?? []
      ).join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Smart Job Discovery Engine</h2>
        <p className="text-sm text-muted-foreground">
          Queries real authorized feeds (Remotive, Arbeitnow, Adzuna, and
          official SmartRecruiters / Greenhouse / Lever / Ashby company boards)
          across Morocco, France, Europe, and Remote markets.
        </p>
      </div>

      {/* Discovery Control Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Search Live Job Feeds</CardTitle>
          <CardDescription>
            Leave keyword blank to automatically search based on your verified
            CV title & skills
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleDiscover} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="md:col-span-2 space-y-1.5">
                <Label>Role, Skill, or Keyword</Label>
                <Input
                  placeholder="e.g. Full-Stack, Data Analyst, Python, QA, DevOps..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Sector</Label>
                <select
                  value={sector}
                  onChange={(e) => setSector(e.target.value)}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                >
                  <option value="any">All Sectors</option>
                  <option value="Software">Software Engineering</option>
                  <option value="Data">Data & AI</option>
                  <option value="Cloud">Cloud & DevOps</option>
                  <option value="Cybersecurity">Cybersecurity</option>
                  <option value="Quality">Quality Assurance</option>
                  <option value="Product">Product & Project Mgmt</option>
                  <option value="Finance">Finance & Business</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Language</Label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as any)}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                >
                  <option value="any">French & English</option>
                  <option value="fr">French (Français)</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Target Locations
                </Label>
                <div className="flex flex-wrap gap-2">
                  {REGION_OPTIONS.map((loc) => {
                    const active = locations.includes(loc);
                    return (
                      <button
                        key={loc}
                        type="button"
                        onClick={() =>
                          setLocations(
                            active
                              ? locations.filter((x) => x !== loc)
                              : [...locations, loc]
                          )
                        }
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {loc}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={remotePref}
                  onChange={(e) => setRemotePref(e.target.value as any)}
                  className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
                >
                  <option value="any">Any Arrangement</option>
                  <option value="remote_only">Remote Only</option>
                  <option value="onsite">On-site / Hybrid</option>
                </select>

                <select
                  value={contractType}
                  onChange={(e) => setContractType(e.target.value)}
                  className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
                >
                  <option value="any">All Contracts</option>
                  <option value="full_time">Full-time / CDI</option>
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
            Showing {displayedJobs.length} verified listings
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
              No discovered jobs match your current view
            </h3>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Click <strong>Discover Live Jobs</strong> above to pull real-time
              openings from Remotive, Arbeitnow, and official employer career
              boards in Morocco, France, and Europe.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {displayedJobs.map((job) => (
            <Card
              key={job.id}
              className="hover:border-primary/40 transition-colors"
            >
              <CardContent className="p-5 space-y-3">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
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
                  <div className="flex flex-wrap gap-1.5">
                    {job.required_skills.slice(0, 10).map((sk: string) => (
                      <Badge key={sk} variant="secondary" className="text-[11px]">
                        {sk}
                      </Badge>
                    ))}
                  </div>
                )}

                {job.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {job.description}
                  </p>
                )}

                {job.public_recruitment_email && (
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">
                    Verified published contact: {job.public_recruitment_email}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
