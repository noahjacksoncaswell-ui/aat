import { useEffect, useState } from "react";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// v5.3 Section 2 / v5.4 Section 1 - shared by the sidebar's UTC/Local box
// and the Range Ops Display header instance, so the ticking logic itself
// (not layout, which differs per placement) is defined once.
export function useLiveClock(): { utcTime: string; localTime: string } {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return {
    utcTime: `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`,
    localTime: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
  };
}
