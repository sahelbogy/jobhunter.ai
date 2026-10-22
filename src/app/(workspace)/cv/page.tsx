"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Trash2,
  UploadCloud,
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
import { formatRelativeDate } from "@/lib/utils";
import { toast } from "sonner";

export default function MyCvPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [resumes, setResumes] = useState<Array<any>>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [selectedResume, setSelectedResume] = useState<any | null>(null);
  const [editableExtracted, setEditableExtracted] = useState<any | null>(null);
  const [analysisWarning, setAnalysisWarning] = useState<string | null>(null);

  async function loadResumes() {
    setLoading(true);
    try {
      const res = await fetch("/api/cv");
      const data = await res.json();
      const list = data.resumes ?? [];
      setResumes(list);
      const active = list.find((r: any) => r.is_active) ?? list[0] ?? null;
      if (active) {
        setSelectedResume(active);
        setEditableExtracted(active.extracted_data ?? {});
      }
    } catch {
      toast.error("Failed to fetch uploaded CVs.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadResumes();
  }, []);

  async function handleFileSelect(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Please select a valid PDF (.pdf) resume.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File size exceeds 10 MB limit.");
      return;
    }

    setUploading(true);
    setAnalysisWarning(null);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/cv", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "CV upload failed.");
        return;
      }

      if (data.warning) {
        setAnalysisWarning(data.warning);
      }

      toast.success(
        `CV parsed (${data.resume.detected_language.toUpperCase()})! Review extracted data below.`
      );
      setSelectedResume(data.resume);
      setEditableExtracted(data.resume.extracted_data ?? {});
      await loadResumes();
    } catch {
      toast.error("Network error during CV upload.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleApplyToProfile() {
    if (!selectedResume || !editableExtracted) return;
    setApplying(true);
    try {
      const res = await fetch(`/api/cv/${selectedResume.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extracted_data: editableExtracted }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Could not sync CV to profile.");
        return;
      }
      toast.success("Extracted CV data verified and applied to My Profile!");
      router.push("/profile");
    } catch {
      toast.error("Failed to apply CV profile.");
    } finally {
      setApplying(false);
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/cv?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast.success("CV deleted from private storage.");
      if (selectedResume?.id === id) {
        setSelectedResume(null);
        setEditableExtracted(null);
      }
      loadResumes();
    } else {
      toast.error("Could not delete CV.");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Intelligent CV Upload & Analysis</h2>
        <p className="text-sm text-muted-foreground">
          Upload French or English PDF resumes (max 10 MB). Stored securely in
          private Supabase Storage with anti-hallucination structured extraction.
        </p>
      </div>

      {/* Upload Dropzone */}
      <Card className="border-dashed border-2 hover:border-primary/60 transition-colors">
        <CardContent className="p-8 text-center space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => handleFileSelect(e.target.files?.[0])}
          />
          <div className="mx-auto h-12 w-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
            {uploading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <UploadCloud className="h-6 w-6" />
            )}
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-base">
              {uploading
                ? "Uploading to private vault & analyzing CV..."
                : "Upload your PDF CV (French or English)"}
            </p>
            <p className="text-xs text-muted-foreground">
              Validated for genuine PDF signature • Maximum size 10 MB • Private
              per-user RLS storage
            </p>
          </div>
          <Button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? "Analyzing PDF..." : "Select PDF File"}
          </Button>
        </CardContent>
      </Card>

      {analysisWarning && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>{analysisWarning}</div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Uploaded Resumes List */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Stored CVs</CardTitle>
            <CardDescription>
              Active CV is attached to approved applications
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <p className="text-xs text-muted-foreground">Loading CVs...</p>
            ) : resumes.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4">
                No CV uploaded yet.
              </p>
            ) : (
              resumes.map((r) => (
                <div
                  key={r.id}
                  onClick={() => {
                    setSelectedResume(r);
                    setEditableExtracted(r.extracted_data ?? {});
                  }}
                  className={`cursor-pointer rounded-xl border p-3.5 space-y-2 transition-colors ${
                    selectedResume?.id === r.id
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-4 w-4 text-primary shrink-0" />
                      <span className="text-sm font-medium truncate">
                        {r.file_name}
                      </span>
                    </div>
                    {r.is_active && <Badge variant="success">Active</Badge>}
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {r.detected_language?.toUpperCase()} •{" "}
                      {Math.round(r.file_size / 1024)} KB •{" "}
                      {formatRelativeDate(r.created_at)}
                    </span>
                    <div
                      className="flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <a
                        href={`/api/cv/${r.id}/download`}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1 hover:text-primary"
                        title="Preview PDF"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </a>
                      <button
                        type="button"
                        onClick={() => handleDelete(r.id)}
                        className="p-1 hover:text-destructive"
                        title="Delete CV"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Extracted Data Review & Correction Panel */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">
                Review & Verify Extracted Profile
              </CardTitle>
              <CardDescription>
                Inspect and correct any extracted fields before syncing to your
                profile
              </CardDescription>
            </div>
            {selectedResume && editableExtracted && (
              <Button onClick={handleApplyToProfile} disabled={applying}>
                {applying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Apply to My Profile
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {!selectedResume || !editableExtracted ? (
              <p className="text-sm text-muted-foreground py-12 text-center">
                Upload or select a CV on the left to inspect its structured
                analysis.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Full Name</Label>
                    <Input
                      value={editableExtracted.full_name || ""}
                      onChange={(e) =>
                        setEditableExtracted({
                          ...editableExtracted,
                          full_name: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Professional Title</Label>
                    <Input
                      value={editableExtracted.professional_title || ""}
                      onChange={(e) =>
                        setEditableExtracted({
                          ...editableExtracted,
                          professional_title: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input
                      value={editableExtracted.email || ""}
                      onChange={(e) =>
                        setEditableExtracted({
                          ...editableExtracted,
                          email: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Phone</Label>
                    <Input
                      value={editableExtracted.phone || ""}
                      onChange={(e) =>
                        setEditableExtracted({
                          ...editableExtracted,
                          phone: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Location</Label>
                    <Input
                      value={editableExtracted.location || ""}
                      onChange={(e) =>
                        setEditableExtracted({
                          ...editableExtracted,
                          location: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Years of Experience</Label>
                    <Input
                      type="number"
                      min={0}
                      max={60}
                      step={0.5}
                      value={editableExtracted.years_of_experience ?? 0}
                      onChange={(e) =>
                        setEditableExtracted({
                          ...editableExtracted,
                          years_of_experience: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Technical Skills (comma-separated)</Label>
                  <Input
                    value={(editableExtracted.technical_skills ?? []).join(
                      ", "
                    )}
                    onChange={(e) => {
                      const arr = e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean);
                      setEditableExtracted({
                        ...editableExtracted,
                        technical_skills: arr,
                        technologies: arr,
                      });
                    }}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Identified Professional Sectors (comma-separated)</Label>
                  <Input
                    value={(editableExtracted.sectors ?? []).join(", ")}
                    onChange={(e) =>
                      setEditableExtracted({
                        ...editableExtracted,
                        sectors: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Summary</Label>
                  <Textarea
                    value={editableExtracted.summary || ""}
                    onChange={(e) =>
                      setEditableExtracted({
                        ...editableExtracted,
                        summary: e.target.value,
                      })
                    }
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
