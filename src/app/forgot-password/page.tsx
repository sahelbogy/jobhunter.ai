"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input, Label } from "@/components/ui/primitives";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
        }
      );
      if (error) {
        toast.error(error.message);
        setLoading(false);
        return;
      }
      setSent(true);
      toast.success("Password reset link dispatched.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to request reset."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Reset Password</CardTitle>
          <CardDescription>
            Receive a secure recovery link to update your account password
          </CardDescription>
        </CardHeader>
        {sent ? (
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              If an account exists for <strong>{email}</strong>, a recovery link
              has been sent. Check your inbox and spam folder.
            </p>
            <Button variant="outline" asChild className="w-full">
              <Link href="/login">
                <ArrowLeft className="h-4 w-4" />
                Back to Sign In
              </Link>
            </Button>
          </CardContent>
        ) : (
          <form onSubmit={handleReset}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Account Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4" />
                )}
                Send Recovery Link
              </Button>
              <Link
                href="/login"
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Back to Sign In
              </Link>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  );
}
