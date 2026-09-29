import React, { useMemo, useState } from "react";
import type { Mission } from "../../types";

// v8.0 Section 3 - a month-at-a-glance calendar highlighting every day that
// falls within any mission's confirmed Launch Period, plus a compact panel
// listing upcoming Launch Periods for direct cross-reference against the
// weather outlook tiers above. Built as a standalone, reusable component
// per Section 3's "could also be surfaced on the Dashboard" note, even
// though it's currently only wired into the METOC page.

interface LaunchDay {
  dateKey: string; // YYYY-MM-DD
  missions: { designator: string; name: string; isTargeted: boolean }[];
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function LaunchPeriodCalendar({ missions }: { missions: Mission[] | undefined }) {
  const [monthOffset, setMonthOffset] = useState(0);

  const byDate = useMemo(() => {
    const map = new Map<string, LaunchDay>();
    for (const m of missions ?? []) {
      for (const entry of (m as any).launchPeriodEntries ?? []) {
        const key = toDateKey(new Date(entry.date));
        const day = map.get(key) ?? { dateKey: key, missions: [] };
        day.missions.push({ designator: m.designator, name: m.name, isTargeted: entry.isTargeted });
        map.set(key, day);
      }
    }
    return map;
  }, [missions]);

  const upcoming = useMemo(() => {
    const todayKey = toDateKey(new Date());
    return Array.from(byDate.values())
      .filter((d) => d.dateKey >= todayKey)
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
      .slice(0, 8);
  }, [byDate]);

  const viewMonth = new Date();
  viewMonth.setUTCDate(1);
  viewMonth.setUTCMonth(viewMonth.getUTCMonth() + monthOffset);
  const year = viewMonth.getUTCFullYear();
  const month = viewMonth.getUTCMonth();
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const startWeekday = firstOfMonth.getUTCDay();
  const monthLabel = firstOfMonth.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  const cells: (number | null)[] = [...Array(startWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_260px]">
      <div className="card p-4">
        <div className="mb-2 flex items-center justify-between">
          <button onClick={() => setMonthOffset((m) => m - 1)} className="btn-secondary px-2 py-1 text-xs">
            &larr;
          </button>
          <div className="text-sm font-bold uppercase tracking-wide">{monthLabel}</div>
          <button onClick={() => setMonthOffset((m) => m + 1)} className="btn-secondary px-2 py-1 text-xs">
            &rarr;
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase text-slate-500 dark:text-slate-400">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((dayNum, i) => {
            if (dayNum == null) return <div key={i} />;
            const key = toDateKey(new Date(Date.UTC(year, month, dayNum)));
            const day = byDate.get(key);
            const targeted = day?.missions.some((m) => m.isTargeted);
            return (
              <div
                key={i}
                title={day ? day.missions.map((m) => `${m.designator} — ${m.name}`).join("\n") : undefined}
                className={`flex h-9 items-center justify-center border text-xs ${
                  day
                    ? targeted
                      ? "border-aat-caution bg-aat-caution/15 font-bold text-aat-caution"
                      : "border-aat-accent bg-aat-accent/10 font-bold text-aat-accent"
                    : "border-slate-200 text-slate-400 dark:border-slate-800 dark:text-slate-600"
                }`}
              >
                {dayNum}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card p-4">
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Upcoming Launch Periods</div>
        {upcoming.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">No upcoming Launch Period days on file.</p>
        ) : (
          <ul className="space-y-1.5 text-xs">
            {upcoming.map((d) => (
              <li key={d.dateKey} className="border-b border-slate-100 pb-1.5 dark:border-slate-900">
                <span className="font-mono">{d.dateKey}</span>
                {" — "}
                {d.missions.map((m) => `${m.designator}${m.isTargeted ? " (TARGETED)" : ""}`).join(", ")}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
