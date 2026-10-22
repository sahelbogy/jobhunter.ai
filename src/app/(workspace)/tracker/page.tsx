"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Calendar,
  Download,
  ExternalLink,
  Loader2,
  Plus,
  Save,
  Search,
  Trash2,
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
import { formatShortDate, scoreColorClasses } from "@/lib/utils";
import { toast } from "sonner";

const TRACKER_STATUSES = [
  { id: "draft", label: "Draft" },
  { id: "pending_approval", label: "Pending Approval" },
  { id: "sent", label: "Sent" },
  { id: "applied_externally", label: "Applied Externally" },
  { id: "interview", label: "Interview" },
  { id: "offer", label: "Offer" },
  { id: "rejected", label: "Rejected" },
  { id: "withdrawn", label: "Withdrawn" },
];

export default function TrackerPage() {
  const [applications, setApplications] = useState<Array<any>>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"newest" | "score" | "company">(
    "newest"
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [showAddExternal, setShowAddExternal] = useState(false);

  const [extCompany, setExtCompany] = useState("");
  const [extTitle, setExtTitle] = useState("");
  const [extLocation, setExtLocation] = useState("");
  const [extUrl, setExtUrl] = useState("");
  const [extNotes, setExtNotes] = useState("");

  async function loadTracker() {
    setLoading(true);
    try {
      const res = await fetch("/api/applications");
      if (res.ok) {
        const d = await res.json();
        setApplications(d.applications ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTracker();
  }, []);

  const filteredAndSorted = useMemo(() => {
    const list = applications.filter((a) => {
      if (statusFilter !== "all" && a.tracking_status !== statusFilter) {
        return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = `${a.company_name} ${a.job_title} ${a.location} ${a.notes ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return [...list].sort((a, b) => {
      if (sortBy === "score") {
        return (b.match_score ?? -1) - (a.match_score ?? -1);
      }
      if (sortBy === "company") {
        return String(a.company_name).localeCompare(String(b.company_name));
      }
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });
  }, [applications, statusFilter, search, sortBy]);

  async function handleUpdateRow(
    id: string,
    patch: {
      tracking_status?: string;
      follow_up_date?: string | null;
      notes?: string;
    }
  ) {
    setSavingId(id);
    try {
      const res = await fetch(`/api/applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to update application.");
        return;
      }
      setApplications((prev) =>
        prev.map((a) => (a.id === id ? { ...a, ...data.application } : a))
      );
      toast.success("Application tracker updated.");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDeleteRow(id: string) {
    setSavingId(id);
    try {
      const res = await fetch(`/api/applications/${id}`, { method: "DELETE" });
      if (res.ok) {
        setApplications((prev) => prev.filter((a) => a.id !== id));
        toast.success("Application removed.");
      }
    } finally {
      setSavingId(null);
    }
  }

  async function handleAddExternal(e: React.FormEvent) {
    e.preventDefault();
    setSavingId("new");
    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: extCompany,
          job_title: extTitle,
          location: extLocation,
          job_url: extUrl || "",
          application_source: "manual_portal",
          tracking_status: "applied_externally",
          queue_for_approval: false,
          notes: extNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Could not log external application.");
        return;
      }
      toast.success("Logged external portal application!");
      setShowAddExternal(false);
      setExtCompany("");
      setExtTitle("");
      setExtLocation("");
      setExtUrl("");
      setExtNotes("");
      await loadTracker();
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Application Tracker CRM</h2>
          <p className="text-sm text-muted-foreground">
            Track statuses, follow-up dates, notes, and delivery confirmation
            across every emailed and portal application.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => setShowAddExternal((v) => !v)}
          >
            <Plus className="h-4 w-4" />
            Log External Application
          </Button>
          <Button asChild>
            <a href="/api/applications?format=csv" download>
              <Download className="h-4 w-4" />
              Export CSV
            </a>
          </Button>
        </div>
      </div>

      {showAddExternal && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="text-base">
              Log Portal / External Application
            </CardTitle>
            <CardDescription>
              Keep all applications in one CRM even when submitted directly on a
              company portal.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddExternal} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <Label>Company *</Label>
                  <Input
                    required
                    value={extCompany}
                    onChange={(e) => setExtCompany(e.target.value)}
                    placeholder="Company name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Job Title *</Label>
                  <Input
                    required
                    value={extTitle}
                    onChange={(e) => setExtTitle(e.target.value)}
                    placeholder="Role title"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Location</Label>
                  <Input
                    value={extLocation}
                    onChange={(e) => setExtLocation(e.target.value)}
                    placeholder="Casablanca / Paris / Remote"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Official Job URL</Label>
                  <Input
                    value={extUrl}
                    onChange={(e) => setExtUrl(e.target.value)}
                    placeholder="https://..."
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Input
                  value={extNotes}
                  onChange={(e) => setExtNotes(e.target.value)}
                  placeholder="Submitted via SmartRecruiters portal with AI Cover Letter PDF"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowAddExternal(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={savingId === "new"}>
                  Save to Tracker
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2 relative">
            <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
            <Input
              placeholder="Search company, role, location, or notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="all">All Statuses</option>
            {TRACKER_STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="newest">Sort: Newest First</option>
            <option value="score">Sort: Highest Match Score</option>
            <option value="company">Sort: Company (A–Z)</option>
          </select>
        </CardContent>
      </Card>

      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          Loading application tracker...
        </div>
      ) : filteredAndSorted.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-sm text-muted-foreground">
            No tracked applications match your current filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredAndSorted.map((app) => (
            <TrackerCard
              key={app.id}
              app={app}
              saving={savingId === app.id}
              onSave={(patch) => handleUpdateRow(app.id, patch)}
              onDelete={() => handleDeleteRow(app.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TrackerCard({
  app,
  saving,
  onSave,
  onDelete,
}: {
  app: any;
  saving: boolean;
  onSave: (patch: any) => void;
  onDelete: () => void;
}) {
  const [status, setStatus] = useState(app.tracking_status ?? "draft");
  const [followUp, setFollowUp] = useState(
    app.follow_up_date ? String(app.follow_up_date).slice(0, 10) : ""
  );
  const [notes, setNotes] = useState(app.notes ?? "");

  const isSent = app.approval_status === "sent";

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-base">
                {app.job_title} — {app.company_name}
              </h3>
              {app.match_score !== null && (
                <Badge className={scoreColorClasses(app.match_score)}>
                  {app.match_score}% Match
                </Badge>
              )}
              <Badge variant={isSent ? "success" : "secondary"}>
                {isSent
                  ? `Email Sent (${formatShortDate(app.sent_at)})`
                  : `Approval: ${app.approval_status}`}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
              <span>{app.location || "Unspecified location"}</span>
              <span>•</span>
              <span>
                Applied / Logged {formatShortDate(app.applied_at ?? app.created_at)}
              </span>
              {app.job_url && (
                <>
                  <span>•</span>
                  <a
                    href={app.job_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    Official Job Link
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={status}
              onChange={(e) => {
                const next = e.target.value;
                setStatus(next);
                onSave({ tracking_status: next });
              }}
              className="h-9 rounded-lg border border-input bg-background px-3 text-xs font-medium"
            >
              {TRACKER_STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>

            <Button
              size="icon"
              variant="ghost"
              onClick={onDelete}
              disabled={saving}
              title="Delete entry"
            >
              <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-xs flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Follow-Up Reminder Date
            </Label>
            <Input
              type="date"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
            />
          </div>
          <div className="md:col-span-2 space-y-1">
            <Label className="text-xs">Notes & Interview Feedback</Label>
            <Textarea
              rows={1}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Recruiter name, interview takeaways, next steps..."
              className="min-h-[40px]"
            />
          </div>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() =>
              onSave({
                tracking_status: status,
                follow_up_date: followUp || null,
                notes,
              })
            }
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Details
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
