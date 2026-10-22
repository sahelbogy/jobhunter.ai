"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Lock,
  Mail,
  Server,
  ShieldCheck,
  Unplug,
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

function EmailsInner() {
  const searchParams = useSearchParams();
  const [connection, setConnection] = useState<any | null>(null);
  const [logs, setLogs] = useState<Array<any>>([]);
  const [oauthConfigured, setOauthConfigured] = useState(false);
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [smtpEmail, setSmtpEmail] = useState("");
  const [smtpAppPassword, setSmtpAppPassword] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(465);
  const [dailyLimit, setDailyLimit] = useState(25);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function loadEmailCenter() {
    setLoading(true);
    try {
      const res = await fetch("/api/email/status");
      if (res.ok) {
        const d = await res.json();
        setConnection(d.connection ?? null);
        setLogs(d.logs ?? []);
        setOauthConfigured(Boolean(d.oauthConfigured));
        setSmtpConfigured(Boolean(d.smtpConfigured));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEmailCenter();
    const connected = searchParams.get("connected");
    const err = searchParams.get("error");
    if (connected === "gmail") {
      toast.success("Gmail OAuth 2.0 account connected securely!");
    } else if (err) {
      toast.error(`Gmail connection error: ${err}`);
    }
  }, [searchParams]);

  const gmailActive =
    connection?.provider === "gmail" && Boolean(connection?.is_active);
  const smtpActive =
    connection?.provider === "smtp" && Boolean(connection?.is_active);

  async function handleConnectGmail() {
    setBusy(true);
    try {
      const res = await fetch("/api/email/gmail/connect");
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Gmail OAuth is not configured on server.");
        return;
      }
      window.location.href = data.url;
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      const res = await fetch("/api/email/status", { method: "DELETE" });
      if (res.ok) {
        toast.success("Disconnected active email sender.");
        await loadEmailCenter();
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleEnableSmtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/email/smtp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email_address: smtpEmail.trim() || undefined,
          app_password: smtpAppPassword.trim() || undefined,
          smtp_host: smtpHost.trim() || undefined,
          smtp_port: Number(smtpPort) || undefined,
          daily_send_limit: Number(dailyLimit),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to enable SMTP sender.");
        return;
      }
      setSmtpAppPassword("");
      toast.success(
        `Boîte email connectée et vérifiée (${data.connection?.email_address}) !`
      );
      await loadEmailCenter();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Email Center & Delivery Audit</h2>
        <p className="text-sm text-muted-foreground">
          Connect Gmail via OAuth 2.0 (minimal <code>gmail.send</code> scope) or
          an authenticated server SMTP relay. OAuth tokens are encrypted at rest
          with AES-256-GCM and never exposed to browser clients.
        </p>
      </div>

      <div className="rounded-2xl border bg-muted/40 p-4 flex items-start gap-3 text-xs text-muted-foreground">
        <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
        <div>
          <strong className="text-foreground">
            Strict Email Delivery Safeguards:
          </strong>{" "}
          Emails are only transmitted after explicit per-application approval in
          the Approval Queue, attach both your original CV PDF and generated
          Cover Letter PDF, enforce idempotency against duplicate sends, and
          record honest provider confirmation (<code>sent</code> /{" "}
          <code>failed</code> — never fabricating read receipts).
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gmail OAuth 2.0 Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-blue-600/10 text-blue-600 flex items-center justify-center">
                  <Mail className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-base">
                    Gmail OAuth 2.0 Integration
                  </CardTitle>
                  <CardDescription>
                    Official Google Workspace / Gmail sender
                  </CardDescription>
                </div>
              </div>
              {gmailActive ? (
                <Badge variant="success">Connected</Badge>
              ) : oauthConfigured ? (
                <Badge variant="secondary">Ready to Connect</Badge>
              ) : (
                <Badge variant="warning">Requires Env Config</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-xs">
            {gmailActive ? (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-2">
                <div className="flex items-center gap-2 font-semibold text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" />
                  Connected as {connection.email_address}
                </div>
                <p className="text-muted-foreground">
                  Daily quota: {connection.sends_today ?? 0} /{" "}
                  {connection.daily_send_limit ?? 25} sent today • Connected{" "}
                  {formatShortDate(connection.last_connected_at)}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={handleDisconnect}
                >
                  <Unplug className="h-3.5 w-3.5" />
                  Disconnect Gmail
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {!oauthConfigured && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-200 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      Configure <code>GOOGLE_CLIENT_ID</code> and{" "}
                      <code>GOOGLE_CLIENT_SECRET</code> in your server
                      environment variables to enable Google OAuth 2.0.
                    </span>
                  </div>
                )}
                <p className="text-muted-foreground leading-relaxed">
                  Requests minimal send-only permission (
                  <code>https://www.googleapis.com/auth/gmail.send</code>) — we
                  never read your inbox messages.
                </p>
                <Button
                  type="button"
                  onClick={handleConnectGmail}
                  disabled={busy}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Lock className="h-4 w-4" />
                  )}
                  Connect Gmail with OAuth 2.0
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Direct Gmail App Password / SMTP Card */}
        <Card className="border-violet-500/40">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-violet-600/10 text-violet-600 flex items-center justify-center">
                  <Server className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-base">
                    Gmail App Password / SMTP Direct (100% Gratuit)
                  </CardTitle>
                  <CardDescription>
                    Connexion directe en 10s sans configurer Google Cloud OAuth
                  </CardDescription>
                </div>
              </div>
              {smtpActive ? (
                <Badge variant="success">Connecté</Badge>
              ) : (
                <Badge variant="secondary">100% Gratuit</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            {smtpActive ? (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-2">
                <div className="font-semibold text-emerald-800 dark:text-emerald-300">
                  Boîte active : {connection.email_address}
                </div>
                <p className="text-muted-foreground">
                  Quota journalier : {connection.sends_today ?? 0} /{" "}
                  {connection.daily_send_limit ?? 25} envoyés aujourd&apos;hui •
                  Utilisée pour vous envoyer vos emails de validation ET envoyer
                  vos candidatures approuvées.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDisconnect}
                  disabled={busy}
                >
                  Déconnecter
                </Button>
              </div>
            ) : (
              <form onSubmit={handleEnableSmtp} className="space-y-3">
                <p className="text-muted-foreground leading-relaxed">
                  Créez gratuitement un{" "}
                  <a
                    href="https://myaccount.google.com/apppasswords"
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-blue-600 dark:text-blue-400 underline"
                  >
                    Mot de passe d&apos;application Gmail (16 caractères)
                  </a>{" "}
                  et collez-le ci-dessous (chiffré AES-256-GCM côté serveur).
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="space-y-1">
                    <Label className="text-xs">Votre adresse email</Label>
                    <Input
                      type="email"
                      placeholder="votre.nom@gmail.com"
                      value={smtpEmail}
                      onChange={(e) => setSmtpEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">
                      Mot de passe d&apos;application (16 car.)
                    </Label>
                    <Input
                      type="password"
                      autoComplete="off"
                      placeholder="xxxx xxxx xxxx xxxx"
                      value={smtpAppPassword}
                      onChange={(e) => setSmtpAppPassword(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="space-y-1">
                    <Label className="text-xs">Hôte SMTP (auto Gmail)</Label>
                    <Input
                      placeholder="smtp.gmail.com"
                      value={smtpHost}
                      onChange={(e) => setSmtpHost(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Port</Label>
                    <Input
                      type="number"
                      value={smtpPort}
                      onChange={(e) => setSmtpPort(Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Quota / jour</Label>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={dailyLimit}
                      onChange={(e) => setDailyLimit(Number(e.target.value))}
                    />
                  </div>
                </div>
                <Button type="submit" size="sm" disabled={busy}>
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Lock className="h-3.5 w-3.5" />
                  )}
                  Vérifier &amp; Connecter ma Boîte Email
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Email Audit Log */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Email Transmission Audit Log
          </CardTitle>
          <CardDescription>
            Immutable record of every approved email transmission attempt and
            provider response
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading logs...</p>
          ) : logs.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">
              No email dispatches recorded yet. Approve and send an application
              in the Approval Queue to inspect real transmission logs here.
            </p>
          ) : (
            <div className="space-y-2.5">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="rounded-xl border p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="font-semibold flex items-center gap-2">
                      <span>To: {log.recipient_email}</span>
                      <Badge
                        variant={
                          log.status === "sent" ? "success" : "destructive"
                        }
                      >
                        {log.status === "sent"
                          ? `Sent via ${String(log.provider || "").toUpperCase()}`
                          : log.status}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground">{log.subject}</p>
                    {log.error_message && (
                      <p className="text-destructive">{log.error_message}</p>
                    )}
                  </div>
                  <div className="text-right text-muted-foreground shrink-0">
                    <div>{formatShortDate(log.created_at)}</div>
                    {log.provider_message_id && (
                      <div className="font-mono text-[10px]">
                        Msg ID: {log.provider_message_id}
                      </div>
                    )}
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

export default function EmailsPage() {
  return (
    <Suspense
      fallback={
        <div className="py-16 text-center text-sm text-muted-foreground">
          Loading Email Center...
        </div>
      }
    >
      <EmailsInner />
    </Suspense>
  );
}
