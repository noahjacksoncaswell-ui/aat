import { useEffect, useState } from "react";

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

// v5.3 Section 2 / v5.4 Section 1 - shared by the sidebar's UTC/Local box
// and the Range Ops Display header instance, so the ticking logic itself
// (not layout, which differs per placement) is defined once.
//
// `showMs` is sidebar-only (the Range Ops header and every other caller
// omit it, keeping the default 1s-tick HH:MM:SS behavior unchanged): when
// on, it ticks at 50ms instead of 1s and appends milliseconds.
export function useLiveClock(options?: { showMs?: boolean }): { utcTime: string; localTime: string } {
  const showMs = options?.showMs ?? false;
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), showMs ? 50 : 1000);
    return () => clearInterval(t);
  }, [showMs]);

  const utcBase = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
  const localBase = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  if (!showMs) return { utcTime: utcBase, localTime: localBase };

  const ms = pad(now.getMilliseconds(), 3);
  return { utcTime: `${utcBase}.${ms}`, localTime: `${localBase}.${ms}` };
}
