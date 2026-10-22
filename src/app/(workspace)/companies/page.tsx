"use client";

import React, { useEffect, useState } from "react";
import {
  Building2,
  ExternalLink,
  Globe,
  Loader2,
  Mail,
  Plus,
  Search,
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
import { toast } from "sonner";

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Array<any>>([]);
  const [loading, setLoading] = useState(true);
  const [methodFilter, setMethodFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [probing, setProbing] = useState(false);

  // Add / Probe form state
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("Software & Technology");
  const [location, setLocation] = useState("Morocco / Europe");
  const [website, setWebsite] = useState("");
  const [careersPage, setCareersPage] = useState("");
  const [atsProvider, setAtsProvider] = useState<
    "smartrecruiters" | "greenhouse" | "lever" | "ashby" | "direct"
  >("smartrecruiters");
  const [atsSlug, setAtsSlug] = useState("");
  const [publicEmail, setPublicEmail] = useState("");

  async function loadCompanies() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/companies?method=${encodeURIComponent(methodFilter)}`
      );
      if (res.ok) {
        const d = await res.json();
        setCompanies(d.companies ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCompanies();
  }, [methodFilter]);

  async function handleAddCompany(e: React.FormEvent) {
    e.preventDefault();
    setProbing(true);
    try {
      const res = await fetch("/api/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          industry,
          location,
          website,
          careers_page: careersPage,
          ats_provider: atsProvider,
          ats_slug: atsSlug,
          public_recruitment_email: publicEmail,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to add company.");
        return;
      }
      toast.success(
        data.vacanciesImported > 0
          ? `Added ${data.company.name} and imported ${data.vacanciesImported} live published vacancies!`
          : `Saved ${data.company.name} to your company research directory.`
      );
      setShowAddForm(false);
      setName("");
      setAtsSlug("");
      setPublicEmail("");
      await loadCompanies();
    } finally {
      setProbing(false);
    }
  }

  const filtered = companies.filter((c) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return `${c.name} ${c.industry} ${c.location} ${c.description}`
      .toLowerCase()
      .includes(q);
  });

  function renderMethodBadge(method: string) {
    if (method === "published_vacancies") {
      return <Badge variant="success">Published Vacancies</Badge>;
    }
    if (method === "spontaneous_application") {
      return <Badge variant="default">Spontaneous Applications</Badge>;
    }
    return <Badge variant="warning">Unverified Direct Channel</Badge>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Company Discovery Engine</h2>
          <p className="text-sm text-muted-foreground">
            Identify relevant employers in Morocco, France, Europe, and Remote
            markets using strictly verified public channels — zero fabricated
            email addresses.
          </p>
        </div>
        <Button onClick={() => setShowAddForm((v) => !v)}>
          <Plus className="h-4 w-4" />
          Probe / Add Company
        </Button>
      </div>

      {showAddForm && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="text-base">
              Connect Company Career Board or Portal
            </CardTitle>
            <CardDescription>
              Probe an official public ATS board (SmartRecruiters, Greenhouse,
              Lever, Ashby) to pull live openings, or register a spontaneous
              application portal.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddCompany} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Company Name *</Label>
                  <Input
                    required
                    placeholder="e.g. Stripe, Cloudflare, Alten"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Industry</Label>
                  <Input
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Location</Label>
                  <Input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Public ATS Feed Type</Label>
                  <select
                    value={atsProvider}
                    onChange={(e) => setAtsProvider(e.target.value as any)}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  >
                    <option value="smartrecruiters">SmartRecruiters API</option>
                    <option value="greenhouse">Greenhouse Board API</option>
                    <option value="lever">Lever Postings API</option>
                    <option value="ashby">Ashby Job Board API</option>
                    <option value="direct">Direct Careers Website</option>
                  </select>
                </div>
                {atsProvider !== "direct" && (
                  <div className="space-y-1.5">
                    <Label>ATS Board Slug</Label>
                    <Input
                      placeholder="e.g. SQLI1, stripe, cloudflare, qonto"
                      value={atsSlug}
                      onChange={(e) => setAtsSlug(e.target.value)}
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>Company Website</Label>
                  <Input
                    placeholder="https://..."
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Careers Page URL</Label>
                  <Input
                    placeholder="https://..."
                    value={careersPage}
                    onChange={(e) => setCareersPage(e.target.value)}
                  />
                </div>
                <div className="md:col-span-2 space-y-1.5">
                  <Label>
                    Verified Public Recruitment Email (Optional — never guess)
                  </Label>
                  <Input
                    placeholder="Only enter an address officially published on the company's careers page"
                    value={publicEmail}
                    onChange={(e) => setPublicEmail(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowAddForm(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={probing}>
                  {probing && <Loader2 className="h-4 w-4 animate-spin" />}
                  Probe & Save Company
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Channel Classification Tabs & Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {[
            { id: "all", label: "All Companies" },
            { id: "published_vacancies", label: "Published Vacancies" },
            {
              id: "spontaneous_application",
              label: "Spontaneous Applications",
            },
            { id: "unverified_channel", label: "Unverified Channel" },
          ].map((tab) => (
            <Button
              key={tab.id}
              size="sm"
              variant={methodFilter === tab.id ? "default" : "outline"}
              onClick={() => setMethodFilter(tab.id)}
            >
              {tab.label}
            </Button>
          ))}
        </div>
        <div className="relative w-full md:w-72">
          <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
          <Input
            placeholder="Search companies..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          Loading company directory...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((c) => (
            <Card key={c.id} className="flex flex-col justify-between">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Building2 className="h-4 w-4" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{c.name}</CardTitle>
                      <CardDescription className="text-xs">
                        {c.industry} • {c.location}
                      </CardDescription>
                    </div>
                  </div>
                  {renderMethodBadge(c.application_method)}
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <p className="text-muted-foreground leading-relaxed">
                  {c.description}
                </p>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {c.vacancies_count > 0 && (
                    <Badge variant="secondary">
                      {c.vacancies_count} Discovered Vacancies
                    </Badge>
                  )}
                  {c.ats_provider && c.ats_provider !== "direct" && (
                    <Badge variant="outline">ATS: {c.ats_provider}</Badge>
                  )}
                </div>

                {c.public_recruitment_email ? (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
                    <Mail className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      Public Recruitment Contact:{" "}
                      <strong>{c.public_recruitment_email}</strong>
                    </span>
                  </div>
                ) : (
                  <div className="rounded-lg bg-muted/60 px-3 py-2 flex items-center gap-2 text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      No public email published — apply via official careers
                      portal
                    </span>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  {c.website && (
                    <Button variant="ghost" size="sm" asChild>
                      <a href={c.website} target="_blank" rel="noreferrer">
                        <Globe className="h-3.5 w-3.5" />
                        Website
                      </a>
                    </Button>
                  )}
                  {c.careers_page && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={c.careers_page} target="_blank" rel="noreferrer">
                        Careers Portal
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
