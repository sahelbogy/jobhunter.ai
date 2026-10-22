import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelativeDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatShortDate(iso?: string | null): string {
  return formatRelativeDate(iso);
}

export function scoreColorClasses(score?: number | null): string {
  const s = score ?? 0;
  if (s >= 80) {
    return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
  }
  if (s >= 65) {
    return "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30";
  }
  if (s >= 45) {
    return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30";
  }
  return "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30";
}
