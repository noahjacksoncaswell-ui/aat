import React, { useEffect, useRef } from "react";
import type { TimeSeriesPoint } from "../../lib/trajectory/types";
import { PHASE_LABELS } from "../../lib/trajectory/labels";

// v6.0 Section 6.3 - the full retained time-series, one row per timestep,
// scrollable. A fine (0.01-0.05s) timestep over a multi-minute flight can
// produce well over ten thousand rows, so this renders a small windowed
// slice around the current scroll position rather than the entire table at
// once - the scrollable-and-highlightable requirement (Section 6.4) still
// holds exactly, just without paying for thousands of live DOM rows.

const ROW_HEIGHT = 22;
const VISIBLE_ROWS = 18;

export interface RawDataTableProps {
  timeSeries: TimeSeriesPoint[];
  scrubIndex: number;
}

export default function RawDataTable({ timeSeries, scrubIndex }: RawDataTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = React.useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const targetTop = Math.max(0, scrubIndex * ROW_HEIGHT - (VISIBLE_ROWS / 2) * ROW_HEIGHT);
    el.scrollTop = targetTop;
    setScrollTop(targetTop);
  }, [scrubIndex]);

  const containerHeight = VISIBLE_ROWS * ROW_HEIGHT;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 4);
  const endIdx = Math.min(timeSeries.length, startIdx + VISIBLE_ROWS + 8);
  const visible = timeSeries.slice(startIdx, endIdx);

  return (
    <div>
      <div className="mb-2 grid grid-cols-12 gap-2 border-b border-zinc-800 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        <div className="col-span-1">T (s)</div>
        <div className="col-span-2">Phase</div>
        <div className="col-span-1">Alt (m)</div>
        <div className="col-span-1">Vel (m/s)</div>
        <div className="col-span-1">Vvert</div>
        <div className="col-span-1">Vhoriz</div>
        <div className="col-span-1">Accel</div>
        <div className="col-span-1">Q (Pa)</div>
        <div className="col-span-1">Mach</div>
        <div className="col-span-1">Mass (kg)</div>
        <div className="col-span-1">Downrange</div>
      </div>
      <div ref={scrollRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} style={{ height: containerHeight, overflowY: "auto" }}>
        <div style={{ height: timeSeries.length * ROW_HEIGHT, position: "relative" }}>
          {visible.map((p, i) => {
            const idx = startIdx + i;
            const isCurrent = idx === scrubIndex;
            return (
              <div
                key={idx}
                className={`absolute grid w-full grid-cols-12 gap-2 border-b border-zinc-900 font-mono text-[10px] ${isCurrent ? "bg-aat-caution/15 text-aat-caution" : "text-zinc-300"}`}
                style={{ top: idx * ROW_HEIGHT, height: ROW_HEIGHT, lineHeight: `${ROW_HEIGHT}px` }}
              >
                <div className="col-span-1">{p.tS.toFixed(2)}</div>
                <div className="col-span-2 truncate font-sans uppercase">{PHASE_LABELS[p.phase]}</div>
                <div className="col-span-1">{p.zUpM.toFixed(1)}</div>
                <div className="col-span-1">{p.speedMs.toFixed(1)}</div>
                <div className="col-span-1">{p.vVerticalMs.toFixed(1)}</div>
                <div className="col-span-1">{p.vHorizontalMs.toFixed(1)}</div>
                <div className="col-span-1">{p.accelMs2.toFixed(1)}</div>
                <div className="col-span-1">{p.qPa.toFixed(0)}</div>
                <div className="col-span-1">{p.mach.toFixed(2)}</div>
                <div className="col-span-1">{p.massKg.toFixed(2)}</div>
                <div className="col-span-1">{p.downrangeM.toFixed(1)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
