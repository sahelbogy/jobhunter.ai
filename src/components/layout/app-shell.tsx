"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  BarChart3,
  Bell,
  Briefcase,
  Building2,
  CheckCircle2,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  Moon,
  Settings,
  Sparkles,
  Sun,
  Target,
  UserCheck,
  Wand2,
  Workflow,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

export interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const SIDEBAR_NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "My Profile", href: "/profile", icon: UserCheck },
  { label: "My CV", href: "/cv", icon: FileText },
  { label: "Find Jobs", href: "/jobs", icon: Briefcase },
  { label: "AI Job Matching", href: "/matching", icon: Target },
  { label: "Companies", href: "/companies", icon: Building2 },
  { label: "AI Application Generator", href: "/generator", icon: Wand2 },
  { label: "Approval Queue", href: "/approvals", icon: CheckCircle2 },
  { label: "Application Tracker", href: "/tracker", icon: ClipboardList },
  { label: "Email Center", href: "/emails", icon: Mail },
  { label: "Automation Settings", href: "/automation", icon: Workflow },
  { label: "Analytics", href: "/analytics", icon: BarChart3 },
  { label: "Account Settings", href: "/settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Array<any>>([]);
  const [userEmail, setUserEmail] = useState<string>("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const supabase = createClient();
      supabase.auth.getUser().then(({ data }) => {
        if (data.user?.email) {
          setUserEmail(data.user.email);
        }
      });
    } catch {
      // Ignore if env not loaded yet
    }

    fetch("/api/notifications")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.notifications) setNotifications(d.notifications);
      })
      .catch(() => {});
  }, [pathname]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  async function handleSignOut() {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      toast.success("Signed out cleanly.");
      router.push("/login");
      router.refresh();
    } catch {
      router.push("/login");
    }
  }

  async function markAllNotificationsRead() {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAllRead: true }),
    }).catch(() => {});
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-72 lg:flex-col lg:fixed lg:inset-y-0 border-r bg-card/85 backdrop-blur-xl z-30">
        <div className="flex h-16 items-center gap-3 px-6 border-b">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-sm">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <span className="font-bold tracking-tight text-base">
              AI JOB HUNTER
            </span>
            <p className="text-[11px] text-muted-foreground">
              Career Automation Cloud
            </p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {SIDEBAR_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all",
                  active
                    ? "bg-gradient-to-r from-blue-600/15 to-violet-600/15 text-primary border border-primary/20 shadow-xs"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    active ? "text-primary" : "text-muted-foreground"
                  )}
                />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t p-4 space-y-3">
          {userEmail && (
            <div className="rounded-xl bg-muted/60 px-3 py-2 text-xs">
              <div className="text-muted-foreground">Signed in as</div>
              <div className="font-medium truncate text-foreground">
                {userEmail}
              </div>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start text-muted-foreground hover:text-foreground"
            onClick={handleSignOut}
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] bg-card border-r flex flex-col z-10">
            <div className="flex h-16 items-center justify-between px-5 border-b">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 text-white">
                  <Sparkles className="h-4 w-4" />
                </div>
                <span className="font-bold text-sm">AI JOB HUNTER</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
              {SIDEBAR_NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active =
                  pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all",
                      active
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
            <div className="border-t p-4">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={handleSignOut}
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </Button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Column */}
      <div className="flex-1 flex flex-col lg:pl-72 min-w-0">
        {/* Topbar */}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b bg-background/85 backdrop-blur-xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-base sm:text-lg font-semibold tracking-tight">
                {SIDEBAR_NAV_ITEMS.find(
                  (i) =>
                    pathname === i.href || pathname.startsWith(`${i.href}/`)
                )?.label ?? "Workspace"}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Notifications Popover */}
            <div className="relative">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setNotifOpen((v) => !v)}
                aria-label="Notifications"
                className="relative"
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-bold text-white">
                    {unreadCount}
                  </span>
                )}
              </Button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl border bg-card p-4 shadow-xl z-40">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold">Notifications</span>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={markAllNotificationsRead}
                        className="text-xs text-primary hover:underline"
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  {notifications.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">
                      No notifications yet. Automation and delivery alerts
                      appear here.
                    </p>
                  ) : (
                    <div className="max-h-72 overflow-y-auto space-y-2">
                      {notifications.slice(0, 10).map((n) => (
                        <div
                          key={n.id}
                          className={cn(
                            "rounded-xl border p-2.5 text-xs",
                            !n.is_read
                              ? "bg-primary/5 border-primary/25"
                              : "bg-background"
                          )}
                        >
                          <div className="font-semibold">{n.title}</div>
                          <p className="text-muted-foreground mt-0.5">
                            {n.message}
                          </p>
                          {n.link_url && (
                            <Link
                              href={n.link_url}
                              onClick={() => setNotifOpen(false)}
                              className="inline-block mt-1 text-primary font-medium hover:underline"
                            >
                              Open →
                            </Link>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Theme Toggle */}
            <Button
              variant="outline"
              size="icon"
              onClick={() =>
                setTheme(theme === "dark" ? "light" : "dark")
              }
              aria-label="Toggle color theme"
            >
              {mounted && theme === "dark" ? (
                <Sun className="h-4 w-4 text-amber-400" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </Button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
