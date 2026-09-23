import React, { useMemo } from "react";

// v6.0 Section 6.2/6.8 - a small, dependency-free SVG line chart. Built
// custom (rather than pulling in a charting library) specifically because
// Section 6.8 flags that charting libraries "commonly ship with their own
// default color schemes and rounded UI chrome" that would need overriding
// anyway - a custom component sidesteps that fight entirely and guarantees
// exact adherence to the monotone/zero-radius/monospace design system.

export interface ChartPoint {
  x: number;
  y: number;
}

export interface ChartProps {
  data: ChartPoint[];
  xLabel: string;
  yLabel: string;
  cursorX?: number;
  cursorPoint?: ChartPoint;
  hLine?: { value: number; label: string };
  circleOverlay?: { radiusM: number };
  height?: number;
  onScrub?: (x: number) => void;
}

const PAD_LEFT = 52;
const PAD_RIGHT = 12;
const PAD_TOP = 10;
const PAD_BOTTOM = 28;

export default function Chart({ data, xLabel, yLabel, cursorX, cursorPoint, hLine, circleOverlay, height = 180, onScrub }: ChartProps) {
  const width = 520;

  const { xMin, xMax, yMin, yMax, pathD, xScale, yScale } = useMemo(() => {
    if (data.length === 0) {
      return { xMin: 0, xMax: 1, yMin: 0, yMax: 1, pathD: "", xScale: (v: number) => v, yScale: (v: number) => v };
    }
    let xMin = data[0].x;
    let xMax = data[0].x;
    let yMin = data[0].y;
    let yMax = data[0].y;
    for (const p of data) {
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
    if (hLine) {
      yMin = Math.min(yMin, hLine.value);
      yMax = Math.max(yMax, hLine.value);
    }
    if (circleOverlay) {
      xMin = Math.min(xMin, -circleOverlay.radiusM);
      xMax = Math.max(xMax, circleOverlay.radiusM);
      yMin = Math.min(yMin, -circleOverlay.radiusM);
      yMax = Math.max(yMax, circleOverlay.radiusM);
    }
    const xSpan = xMax - xMin || 1;
    const ySpan = yMax - yMin || 1;
    const yPad = ySpan * 0.08;
    yMin -= yPad;
    yMax += yPad;

    const innerW = width - PAD_LEFT - PAD_RIGHT;
    const innerH = height - PAD_TOP - PAD_BOTTOM;
    const xScale = (v: number) => PAD_LEFT + ((v - xMin) / xSpan) * innerW;
    const yScale = (v: number) => PAD_TOP + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;

    const pathD = data.map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.x).toFixed(1)} ${yScale(p.y).toFixed(1)}`).join(" ");

    return { xMin, xMax, yMin, yMax, pathD, xScale, yScale };
  }, [data, hLine, circleOverlay, height]);

  const circlePath = useMemo(() => {
    if (!circleOverlay) return "";
    const pts: string[] = [];
    for (let i = 0; i <= 64; i++) {
      const theta = (i / 64) * Math.PI * 2;
      const px = circleOverlay.radiusM * Math.cos(theta);
      const py = circleOverlay.radiusM * Math.sin(theta);
      pts.push(`${i === 0 ? "M" : "L"} ${xScale(px).toFixed(1)} ${yScale(py).toFixed(1)}`);
    }
    return pts.join(" ") + " Z";
  }, [circleOverlay, xScale, yScale]);

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (!onScrub) return;
    const rect = (e.target as SVGSVGElement).getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const innerW = width - PAD_LEFT - PAD_RIGHT;
    const frac = Math.max(0, Math.min(1, (px - PAD_LEFT) / innerW));
    onScrub(xMin + frac * (xMax - xMin));
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`w-full ${onScrub ? "cursor-crosshair" : ""}`}
      onPointerDown={handlePointerDown}
      onPointerMove={(e) => e.buttons === 1 && handlePointerDown(e)}
    >
      {/* axes */}
      <line x1={PAD_LEFT} y1={PAD_TOP} x2={PAD_LEFT} y2={height - PAD_BOTTOM} stroke="#3f3f46" strokeWidth={1} />
      <line x1={PAD_LEFT} y1={height - PAD_BOTTOM} x2={width - PAD_RIGHT} y2={height - PAD_BOTTOM} stroke="#3f3f46" strokeWidth={1} />

      <text x={PAD_LEFT} y={12} fill="#71717a" fontSize={9} fontFamily="monospace">
        {yMax.toFixed(yMax - yMin < 5 ? 2 : 0)}
      </text>
      <text x={PAD_LEFT} y={height - PAD_BOTTOM - 2} fill="#71717a" fontSize={9} fontFamily="monospace">
        {yMin.toFixed(yMax - yMin < 5 ? 2 : 0)}
      </text>
      <text x={width - PAD_RIGHT} y={height - 12} fill="#71717a" fontSize={9} fontFamily="monospace" textAnchor="end">
        {xMax.toFixed(1)}
      </text>
      <text x={PAD_LEFT} y={height - 12} fill="#71717a" fontSize={9} fontFamily="monospace">
        {xMin.toFixed(1)}
      </text>
      <text x={(width - PAD_RIGHT + PAD_LEFT) / 2} y={height - 2} fill="#52525b" fontSize={9} fontFamily="monospace" textAnchor="middle">
        {xLabel}
      </text>
      <text x={12} y={(PAD_TOP + height - PAD_BOTTOM) / 2} fill="#52525b" fontSize={9} fontFamily="monospace" textAnchor="middle" transform={`rotate(-90, 12, ${(PAD_TOP + height - PAD_BOTTOM) / 2})`}>
        {yLabel}
      </text>

      {circleOverlay && <path d={circlePath} fill="none" stroke="#c98a1a" strokeWidth={1} strokeDasharray="3,3" />}
      {hLine && (
        <>
          <line x1={PAD_LEFT} y1={yScale(hLine.value)} x2={width - PAD_RIGHT} y2={yScale(hLine.value)} stroke="#c98a1a" strokeWidth={1} strokeDasharray="3,3" />
          <text x={width - PAD_RIGHT} y={yScale(hLine.value) - 3} fill="#c98a1a" fontSize={8} fontFamily="monospace" textAnchor="end">
            {hLine.label}
          </text>
        </>
      )}

      <path d={pathD} fill="none" stroke="#e4e4e7" strokeWidth={1.5} />

      {cursorX != null && (
        <line x1={xScale(cursorX)} y1={PAD_TOP} x2={xScale(cursorX)} y2={height - PAD_BOTTOM} stroke="#c98a1a" strokeWidth={1.5} />
      )}
      {cursorPoint && <circle cx={xScale(cursorPoint.x)} cy={yScale(cursorPoint.y)} r={4} fill="#c98a1a" stroke="#000000" strokeWidth={1} />}
    </svg>
  );
}
