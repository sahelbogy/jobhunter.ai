import Link from "next/link";
import { ArrowLeft, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PrivacyPolicyPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-12 space-y-8">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" asChild>
          <Link href="/">
            <ArrowLeft className="h-4 w-4" />
            Back to Home
          </Link>
        </Button>
        <span className="text-xs text-muted-foreground">
          Last updated: October 22, 2026
        </span>
      </div>

      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 text-primary font-semibold text-sm">
          <Shield className="h-4 w-4" />
          Privacy Policy & Data Governance
        </div>
        <h1 className="text-3xl font-bold tracking-tight">
          AI Job Hunter — Privacy & Security Policy
        </h1>
        <p className="text-muted-foreground text-sm">
          This template governs how AI Job Hunter processes personal career
          documents, AI prompts, and email integrations.
        </p>
      </div>

      <div className="space-y-6 text-sm leading-relaxed text-foreground/90">
        <section className="rounded-2xl border bg-card p-6 space-y-2">
          <h2 className="text-base font-semibold">1. Data We Collect & Store</h2>
          <p className="text-muted-foreground">
            We store only the account credentials, structured professional
            profile, uploaded PDF CVs, generated cover letters, discovered job
            bookmarks, and application tracking records that you explicitly
            create inside your workspace. All records are isolated per user via
            PostgreSQL Row Level Security (RLS).
          </p>
        </section>

        <section className="rounded-2xl border bg-card p-6 space-y-2">
          <h2 className="text-base font-semibold">
            2. Document & Token Security
          </h2>
          <p className="text-muted-foreground">
            Uploaded PDF resumes and generated cover letters are stored in
            private Supabase Storage buckets restricted to your authenticated
            user ID. Connected Gmail OAuth tokens are encrypted at rest on the
            server using AES-256-GCM and are never exposed to browser clients.
          </p>
        </section>

        <section className="rounded-2xl border bg-card p-6 space-y-2">
          <h2 className="text-base font-semibold">
            3. AI Processing & Anti-Fabrication Controls
          </h2>
          <p className="text-muted-foreground">
            CV text and job postings are processed exclusively through
            configured server-side AI providers (Groq Cloud, Google Gemini, or
            optional xAI Grok) to extract factual skills, score compatibility,
            and draft tailored emails/cover letters. External job content is
            sanitized against prompt injection and can never authorize sending
            emails.
          </p>
        </section>

        <section className="rounded-2xl border bg-card p-6 space-y-2">
          <h2 className="text-base font-semibold">
            4. Explicit Human Approval Before Email Delivery
          </h2>
          <p className="text-muted-foreground">
            AI Job Hunter never sends emails without your explicit approval on
            the exact recipient, subject, message body, CV attachment, and cover
            letter PDF. You may disconnect Gmail at any time from Email Center.
          </p>
        </section>

        <section className="rounded-2xl border bg-card p-6 space-y-2">
          <h2 className="text-base font-semibold">
            5. Data Portability & Right to Erasure
          </h2>
          <p className="text-muted-foreground">
            In <strong>Account Settings</strong>, you can export a complete JSON
            archive of your workspace data or permanently delete your account,
            which immediately erases your private PDF files from Supabase
            Storage and cascades deletion across all database tables.
          </p>
        </section>
      </div>
    </div>
  );
}
