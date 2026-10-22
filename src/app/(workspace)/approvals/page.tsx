"use client";

import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  Edit3,
  ExternalLink,
  Eye,
  FileText,
  Loader2,
  Lock,
  RefreshCw,
  Send,
  ShieldAlert,
  XCircle,
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
import { scoreColorClasses } from "@/lib/utils";
import { toast } from "sonner";

export default function ApprovalQueuePage() {
  const [applications, setApplications] = useState<Array<any>>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Preview / Edit modal state
  const [previewApp, setPreviewApp] = useState<any | null>(null);
  const [editingApp, setEditingApp] = useState<any | null>(null);
  const [editRecipient, setEditRecipient] = useState("");
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editCoverLetter, setEditCoverLetter] = useState("");

  async function loadQueue() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/applications?approvalStatus=${encodeURIComponent(statusFilter)}`
      );
      if (res.ok) {
        const d = await res.json();
        setApplications(d.applications ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadQueue();
  }, [statusFilter]);

  function openEdit(app: any) {
    setEditingApp(app);
    setEditRecipient(app.recipient_email ?? "");
    setEditSubject(app.email_subject ?? "");
    setEditBody(app.email_body ?? "");
    setEditCoverLetter(app.cover_letter_text ?? "");
  }

  async function handleSaveEdit() {
    if (!editingApp) return;
    setBusyId(editingApp.id);
    try {
      const res = await fetch(`/api/applications/${editingApp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient_email: editRecipient.trim() || null,
          email_subject: editSubject,
          email_body: editBody,
          cover_letter_text: editCoverLetter,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Could not save edits.");
        return;
      }
      if (data.approvalInvalidated) {
        toast.warning(
          "Prior approval was invalidated because recipient or content changed. Please re-approve before sending."
        );
      } else {
        toast.success("Application updated and Cover Letter PDF refreshed.");
      }
      setEditingApp(null);
      await loadQueue();
    } finally {
      setBusyId(null);
    }
  }

  async function handleApprove(appId: string) {
    setBusyId(appId);
    try {
      const res = await fetch(`/api/applications/${appId}/approve`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Approval failed.");
        return;
      }
      toast.success(
        "Application cryptographically approved! You may now dispatch the email."
      );
      await loadQueue();
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(appId: string) {
    setBusyId(appId);
    try {
      const res = await fetch(`/api/applications/${appId}/reject`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Reject failed.");
        return;
      }
      toast.success("Application rejected.");
      await loadQueue();
    } finally {
      setBusyId(null);
    }
  }

  async function handleRegenerate(app: any) {
    if (!app.job_id) {
      toast.error("Only job-linked applications can be regenerated via AI.");
      return;
    }
    setBusyId(app.id);
    try {
      const res = await fetch("/api/applications/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: app.job_id,
          languageOverride: app.language || "auto",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Regeneration failed.");
        return;
      }
      toast.success(
        "Regenerated email & Cover Letter PDF. Review and approve before sending."
      );
      await loadQueue();
    } finally {
      setBusyId(null);
    }
  }

  async function handleSend(appId: string) {
    setBusyId(appId);
    try {
      const res = await fetch(`/api/applications/${appId}/send`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Email dispatch failed.");
        await loadQueue();
        return;
      }
      toast.success(`Email sent! ${data.deliverySummary}`);
      await loadQueue();
    } finally {
      setBusyId(null);
    }
  }

  function statusBadge(status: string) {
    switch (status) {
      case "approved":
        return <Badge variant="success">Approved (Ready to Send)</Badge>;
      case "awaiting_approval":
        return <Badge variant="warning">Awaiting Approval</Badge>;
      case "sent":
        return <Badge variant="success">Sent</Badge>;
      case "sending":
        return <Badge variant="default">Sending...</Badge>;
      case "failed":
        return <Badge variant="destructive">Failed</Badge>;
      case "rejected":
        return <Badge variant="destructive">Rejected</Badge>;
      default:
        return <Badge variant="secondary">Draft</Badge>;
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Manual Approval Queue</h2>
        <p className="text-sm text-muted-foreground">
          Mandatory security gate: every recipient, subject, message body, CV
          attachment, and Cover Letter PDF must be explicitly approved by you
          before sending. Any edit automatically requires fresh approval.
        </p>
      </div>

      {/* Status Filter Pills */}
      <div className="flex flex-wrap gap-2">
        {[
          { id: "all", label: "All" },
          { id: "awaiting_approval", label: "Awaiting Approval" },
          { id: "approved", label: "Approved" },
          { id: "draft", label: "Draft" },
          { id: "sent", label: "Sent" },
          { id: "failed", label: "Failed" },
          { id: "rejected", label: "Rejected" },
        ].map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={statusFilter === f.id ? "default" : "outline"}
            onClick={() => setStatusFilter(f.id)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {/* Edit Modal */}
      {editingApp && (
        <Card className="border-primary shadow-lg">
          <CardHeader>
            <CardTitle className="text-base">
              Edit Application — {editingApp.job_title} at{" "}
              {editingApp.company_name}
            </CardTitle>
            <CardDescription>
              Note: Modifying recipient, subject, email body, or cover letter
              resets approval and refreshes the Cover Letter PDF.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Recipient Email</Label>
                <Input
                  value={editRecipient}
                  onChange={(e) => setEditRecipient(e.target.value)}
                  placeholder="recrutement@company.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Email Subject</Label>
                <Input
                  value={editSubject}
                  onChange={(e) => setEditSubject(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Email Body</Label>
                <Textarea
                  rows={10}
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Cover Letter Text</Label>
                <Textarea
                  rows={10}
                  value={editCoverLetter}
                  onChange={(e) => setEditCoverLetter(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditingApp(null)}>
                Cancel
              </Button>
              <Button
                onClick={handleSaveEdit}
                disabled={busyId === editingApp.id}
              >
                {busyId === editingApp.id && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                Save Changes
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Preview Modal */}
      {previewApp && (
        <Card className="border-violet-500/50 shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">
                Full Application Package Preview — {previewApp.company_name}
              </CardTitle>
              <CardDescription>
                Subject: {previewApp.email_subject}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPreviewApp(null)}
            >
              Close Preview
            </Button>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="rounded-xl border p-4 space-y-2 bg-muted/30">
              <div className="font-semibold text-sm">Email Message</div>
              <div className="text-muted-foreground">
                To: {previewApp.recipient_email || "Official Portal Application"}
              </div>
              <pre className="whitespace-pre-wrap font-sans leading-relaxed text-foreground">
                {previewApp.email_body}
              </pre>
            </div>
            <div className="rounded-xl border p-4 space-y-2 bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">Cover Letter</span>
                <a
                  href={`/api/applications/${previewApp.id}/document?type=cover_letter`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline font-medium"
                >
                  Open PDF ↗
                </a>
              </div>
              <pre className="whitespace-pre-wrap font-sans leading-relaxed text-foreground">
                {previewApp.cover_letter_text}
              </pre>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Queue Items */}
      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          Loading approval queue...
        </div>
      ) : applications.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center space-y-2">
            <Lock className="h-8 w-8 text-primary mx-auto" />
            <p className="font-semibold text-base">
              No applications in this queue state
            </p>
            <p className="text-xs text-muted-foreground">
              Generate tailored applications from Find Jobs or AI Application
              Generator to review them here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {applications.map((app) => {
            const docs: Array<any> = app.documents ?? [];
            const hasCv = docs.some((d) => d.document_type === "cv");
            const hasCl = docs.some((d) => d.document_type === "cover_letter");
            const isBusy = busyId === app.id;

            return (
              <Card key={app.id}>
                <CardContent className="p-5 space-y-4">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-base">
                          {app.job_title} — {app.company_name}
                        </h3>
                        {statusBadge(app.approval_status)}
                        {app.match_score !== null && (
                          <Badge className={scoreColorClasses(app.match_score)}>
                            Match: {app.match_score}%
                          </Badge>
                        )}
                        <Badge variant="outline">
                          {app.language?.toUpperCase()}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Source: {app.application_source} • Recipient:{" "}
                        <strong>
                          {app.recipient_email || "No verified email (Portal only)"}
                        </strong>
                      </p>
                      {app.approval_hash && (
                        <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-mono">
                          SHA-256 Approval Lock: {app.approval_hash.slice(0, 20)}...
                        </p>
                      )}
                    </div>

                    {/* Attachment Badges */}
                    <div className="flex flex-wrap items-center gap-2">
                      {hasCl && (
                        <a
                          href={`/api/applications/${app.id}/document?type=cover_letter`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs hover:bg-muted"
                        >
                          <FileText className="h-3.5 w-3.5 text-violet-500" />
                          Cover Letter PDF
                        </a>
                      )}
                      {hasCv && (
                        <a
                          href={`/api/applications/${app.id}/document?type=cv`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs hover:bg-muted"
                        >
                          <FileText className="h-3.5 w-3.5 text-blue-500" />
                          Original CV PDF
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Subject & Snippet */}
                  <div className="rounded-xl bg-muted/40 p-3.5 text-xs space-y-1.5">
                    <div className="font-semibold">
                      Subject: {app.email_subject}
                    </div>
                    <p className="text-muted-foreground line-clamp-3 whitespace-pre-line">
                      {app.email_body}
                    </p>
                  </div>

                  {!app.recipient_email && app.job_url && (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-800 dark:text-amber-200">
                      <span className="inline-flex items-center gap-1.5">
                        <ShieldAlert className="h-4 w-4 shrink-0" />
                        No verified email contact published for this role —
                        apply on the official portal with your generated Cover
                        Letter PDF:
                      </span>
                      <a
                        href={app.job_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-semibold underline"
                      >
                        Official Application Page
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}

                  {/* Mandatory 6 Action Buttons: Preview, Edit, Regenerate, Approve, Reject, Send */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPreviewApp(app)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Preview
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy || app.approval_status === "sent"}
                        onClick={() => openEdit(app)}
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          isBusy ||
                          !app.job_id ||
                          app.approval_status === "sent"
                        }
                        onClick={() => handleRegenerate(app)}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Regenerate
                      </Button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy || app.approval_status === "sent"}
                        onClick={() => handleReject(app.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={
                          isBusy ||
                          app.approval_status === "approved" ||
                          app.approval_status === "sent"
                        }
                        onClick={() => handleApprove(app.id)}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="success"
                        disabled={isBusy || app.approval_status !== "approved"}
                        onClick={() => handleSend(app.id)}
                      >
                        {isBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        Send
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
