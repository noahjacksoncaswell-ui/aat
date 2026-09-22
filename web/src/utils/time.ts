export function formatTimestamp(iso: string | Date | null | undefined, useZulu: boolean): string {
  if (!iso) return "--";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "--";
  if (useZulu) {
    return (
      d
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d+Z$/, "Z")
    );
  }
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatDateOnly(iso: string | Date | null | undefined, useZulu: boolean): string {
  if (!iso) return "--";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (useZulu) return d.toISOString().slice(0, 10);
  return d.toLocaleDateString();
}

// Revision Directive v4.0 Section 7.1 reassigns clock prefixes per-clock (W-
// for Window Clock, T- for Test Clock, L- for Launch Clock), so the prefix is
// no longer hardcoded here - callers pass the pair that applies to their box.
export function formatCountdown(
  targetIso: string | Date,
  now: Date = new Date(),
  prefixes: { future: string; past: string } = { future: "T-", past: "T+" }
): { text: string; isPast: boolean } {
  const target = typeof targetIso === "string" ? new Date(targetIso) : targetIso;
  const diffMs = target.getTime() - now.getTime();
  const isPast = diffMs < 0;
  const abs = Math.abs(diffMs);
  const totalSeconds = Math.floor(abs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const core = days > 0 ? `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return { text: `${isPast ? prefixes.past : prefixes.future}${core}`, isPast };
}
