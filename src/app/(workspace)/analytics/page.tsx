"use client";

import React, { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CheckCircle2, Send, Sparkles, Target } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const CHART_COLORS = [
  "#2563eb",
  "#7c3aed",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
];

export default function AnalyticsPage() {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/analytics")
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        Querying real-time PostgreSQL analytics...
      </div>
    );
  }

  const kpis = data?.kpis ?? {};
  const weeklySeries = data?.weeklySeries ?? [];
  const monthlySeries = data?.monthlySeries ?? [];
  const outcomes = data?.outcomes ?? [];
  const scoreBuckets = data?.scoreBuckets ?? [];

  const funnel = [
    { stage: "Discovered", count: kpis.jobsDiscovered ?? 0 },
    { stage: "Relevant (>=65%)", count: kpis.relevantMatches ?? 0 },
    { stage: "Drafts Generated", count: kpis.applicationsGenerated ?? 0 },
    { stage: "Approved", count: kpis.applicationsApproved ?? 0 },
    { stage: "Sent / Applied", count: kpis.applicationsSent ?? 0 },
    { stage: "Interviews", count: kpis.interviews ?? 0 },
    { stage: "Offers", count: kpis.offers ?? 0 },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">
          Application & Compatibility Analytics
        </h2>
        <p className="text-sm text-muted-foreground">
          100% database-backed telemetry computed from your live discovered
          jobs, compatibility scores, approval queue, and sent email logs.
        </p>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Jobs Discovered</p>
              <p className="text-2xl font-bold mt-1">
                {kpis.jobsDiscovered ?? 0}
              </p>
            </div>
            <Target className="h-6 w-6 text-blue-600" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">
                Relevant Matches (&gt;=65%)
              </p>
              <p className="text-2xl font-bold mt-1">
                {kpis.relevantMatches ?? 0}
              </p>
            </div>
            <Sparkles className="h-6 w-6 text-violet-600" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">
                Applications Sent / Applied
              </p>
              <p className="text-2xl font-bold mt-1">
                {kpis.applicationsSent ?? 0}
              </p>
            </div>
            <Send className="h-6 w-6 text-emerald-600" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">
                Interview Conversion
              </p>
              <p className="text-2xl font-bold mt-1">
                {kpis.conversionToInterviewPct ?? 0}%
              </p>
            </div>
            <CheckCircle2 className="h-6 w-6 text-amber-500" />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Conversion Funnel */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Job-Hunting Conversion Funnel
            </CardTitle>
            <CardDescription>
              Progression from discovered vacancies to interviews and offers
            </CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={funnel}
                layout="vertical"
                margin={{ top: 5, right: 24, left: 24, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                <XAxis type="number" allowDecimals={false} fontSize={11} />
                <YAxis
                  dataKey="stage"
                  type="category"
                  width={130}
                  fontSize={11}
                />
                <Tooltip />
                <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                  {funnel.map((_, idx) => (
                    <Cell
                      key={idx}
                      fill={CHART_COLORS[idx % CHART_COLORS.length]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Match Score Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Compatibility Score Distribution
            </CardTitle>
            <CardDescription>
              Distribution of 0–100% compatibility scores across discovered jobs
            </CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={scoreBuckets}
                margin={{ top: 10, right: 20, left: 0, bottom: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                <XAxis dataKey="range" fontSize={11} />
                <YAxis allowDecimals={false} fontSize={11} />
                <Tooltip />
                <Bar dataKey="count" fill="#7c3aed" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 8-Week Activity Timeline */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              8-Week Activity Series
            </CardTitle>
            <CardDescription>
              Weekly discovered jobs vs generated drafts vs sent applications
            </CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklySeries}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                <XAxis dataKey="week" fontSize={11} />
                <YAxis allowDecimals={false} fontSize={11} />
                <Tooltip />
                <Bar
                  dataKey="discovered"
                  name="Discovered"
                  fill="#0ea5e9"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="generated"
                  name="Generated"
                  fill="#2563eb"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="sent"
                  name="Sent"
                  fill="#10b981"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* 6-Month Overview & Tracker Outcomes */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              6-Month Trend & CRM Outcomes
            </CardTitle>
            <CardDescription>
              Monthly applications & interviews ({outcomes.length} active status
              groups)
            </CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlySeries}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis allowDecimals={false} fontSize={11} />
                <Tooltip />
                <Bar
                  dataKey="applications"
                  name="Applications"
                  fill="#7c3aed"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="interviews"
                  name="Interviews"
                  fill="#f59e0b"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
