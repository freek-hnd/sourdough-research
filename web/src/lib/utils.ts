import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateShortId(
  type: "starter" | "dough",
  date: Date,
  childIndex: number,
): string {
  const prefix = type === "dough" ? "D" : "S";
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const letter = String.fromCharCode(65 + childIndex);
  return `${prefix}${mm}${dd}-${letter}`;
}

export function formatElapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours > 0) return `${hours}h`;
  return `${Math.floor(ms / 60_000)}m`;
}
