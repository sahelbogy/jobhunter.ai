"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Sparkles,
  Target,
  Wand2,
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
import { Badge, Label } from "@/components/ui/primitives";
import { scoreColorClasses } from "@/lib/utils";
import { toast } from "sonner";

export default function MatchingPage() {
  const [matches, setMatches] = useState<Array<any>>([]);
  const [minScore, setMinScore] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rescoring, setRescoring] = useState(false);
  const [deepMatchingId, setDeepMatchingId] = useState<string | null>(null);

  async function loadMatches(scoreFilter = minScore) {
    setLoading(true);
    try {
      const res = await fetch(`/api/matching?minScore=${scoreFilter}`);
      if (res.ok) {
        const d = await res.json();
        setMatches(d.matches ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMatches(minScore);
  }, [minScore]);

  async function handleRescoreAll() {
    setRescoring(true);
    try {
      const res = await fetch("/api/matching", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "rescore_all" }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to recalculate scores.");
        return;
      }
      toast.success(`Recalculated compatibility for ${data.updatedCount} jobs.`);
      await loadMatches(minScore);
    } finally {
      setRescoring(false);
    }
  }

  async function handleAiDeepMatch(jobId: string) {
    setDeepMatchingId(jobId);
    try {
      const res = await fetch("/api/matching", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "ai_deep_match", jobId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "AI matching failed.");
        return;
      }
      toast.success(
        `Updated match analysis (${data.match.scoring_method === "hybrid_ai" ? "Hybrid AI" : "Deterministic"}).`
      );
      setMatches((prev) =>
        prev.map((m) => (m.job_id === jobId ? data.match : m))
      );
    } finally {
      setDeepMatchingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">AI Job Compatibility Matching</h2>
          <p className="text-sm text-muted-foreground">
            Multi-factor 0–100 compatibility scoring across skills, experience,
            education, languages, location, and sector.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleRescoreAll}
          disabled={rescoring}
        >
          {rescoring ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Recalculate All Scores
        </Button>
      </div>

      {/* Transparency Notice & Filter */}
      <Card>
        <CardContent className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-2.5 text-xs text-muted-foreground max-w-2xl">
            <AlertCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <span>
              <strong>Compatibility Indicator Notice:</strong> Each Match Score
              (0–100%) estimates alignment between your verified profile and the
              published job description. It is an analytical decision aid, not a
              prediction or guarantee of hiring success.
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Label className="text-xs whitespace-nowrap">
              Min Score: <strong>{minScore}%</strong>
            </Label>
            <input
              type="range"
              min={0}
              max={90}
              step={5}
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="w-36 accent-blue-600"
            />
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          Loading compatibility rankings...
        </div>
      ) : matches.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center space-y-3">
            <Target className="h-9 w-9 text-primary mx-auto" />
            <h3 className="font-semibold">
              No opportunities above {minScore}% compatibility
            </h3>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Lower the minimum score filter or discover new opportunities in
              Find Jobs.
            </p>
            <Button size="sm" asChild>
              <Link href="/jobs">Go to Find Jobs</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {matches.map((m) => {
            const job = m.job ?? {};
            const bd = m.score_breakdown ?? {};
            return (
              <Card key={m.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <CardTitle className="text-base">{job.title}</CardTitle>
                        <Badge
                          className={`text-xs font-bold px-3 py-1 ${scoreColorClasses(
                            m.match_score
                          )}`}
                        >
                          Match Score: {m.match_score}%
                        </Badge>
                        <Badge variant="outline">
                          {m.scoring_method === "hybrid_ai"
                            ? `AI Enriched (${m.ai_provider})`
                            : "Verified Baseline"}
                        </Badge>
                      </div>
                      <CardDescription>
                        {job.company_name} • {job.location} • {job.sector}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={deepMatchingId === m.job_id}
                        onClick={() => handleAiDeepMatch(m.job_id)}
                      >
                        {deepMatchingId === m.job_id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" />
                        )}
                        AI Deep Analysis
                      </Button>
                      <Button size="sm" asChild>
                        <Link href={`/generator?jobId=${m.job_id}`}>
                          <Wand2 className="h-3.5 w-3.5" />
                          Tailor Application
                        </Link>
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Explanation */}
                  <div className="rounded-xl bg-muted/50 p-3.5 text-sm leading-relaxed">
                    <p>{m.explanation}</p>
                    <p className="text-xs font-medium text-primary mt-1.5">
                      Recommendation: {m.recommendation}
                    </p>
                  </div>

                  {/* Factor Bars */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
                    {[
                      { label: "Skills", val: bd.technical_skills },
                      { label: "Experience", val: bd.experience },
                      { label: "Sector", val: bd.sector },
                      { label: "Language", val: bd.language ?? bd.languages },
                      { label: "Location", val: bd.location },
                      { label: "Education", val: bd.education },
                    ].map((f) => (
                      <div
                        key={f.label}
                        className="rounded-lg border p-2.5 space-y-1.5"
                      >
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            {f.label}
                          </span>
                          <span className="font-semibold">{f.val ?? 0}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-blue-600 to-violet-600"
                            style={{ width: `${Math.min(100, f.val ?? 0)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Skills & Strengths / Weaknesses */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div className="space-y-2">
                      <div className="font-semibold flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Matching Skills & Strengths
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(m.matching_skills ?? []).map((s: string) => (
                          <Badge key={s} variant="success">
                            {s}
                          </Badge>
                        ))}
                      </div>
                      <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
                        {(m.strengths ?? []).map((st: string, i: number) => (
                          <li key={i}>{st}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="space-y-2">
                      <div className="font-semibold flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                        <XCircle className="h-3.5 w-3.5" />
                        Missing Skills & Considerations
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(m.missing_skills ?? []).length === 0 ? (
                          <span className="text-muted-foreground">
                            No critical skill gaps flagged
                          </span>
                        ) : (
                          (m.missing_skills ?? []).map((s: string) => (
                            <Badge key={s} variant="warning">
                              {s}
                            </Badge>
                          ))
                        )}
                      </div>
                      <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
                        {(m.weaknesses ?? []).map((wk: string, i: number) => (
                          <li key={i}>{wk}</li>
                        ))}
                      </ul>
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
