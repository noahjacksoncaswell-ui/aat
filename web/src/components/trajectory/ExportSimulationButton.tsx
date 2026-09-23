import React, { useState } from "react";
import { uploadDocument } from "../../api/resources";
import { buildTrajectoryReportPdf, reportTitle } from "../../lib/trajectory/pdfExport";
import { downscaleDataUrl, svgElementToPngDataUrl } from "../../lib/trajectory/svgCapture";
import { TRAJECTORY_SIMULATION_REPORT_CATEGORY } from "../../types";
import type { RunMeta } from "../../lib/trajectory/formConfig";
import type { SimConfig, SimResult } from "../../lib/trajectory/types";
import type { Scene3DHandle } from "./Scene3D";

// v6.0 Section 6.5 - Export Simulation. Captures every chart's SVG and the
// 3D viewport's WebGL canvas as images, assembles the PDF report, and
// automatically archives it to the Documentation Library under the new
// "Trajectory Simulation Report" category using the directive's exact
// naming convention.
export interface ExportSimulationButtonProps {
  config: SimConfig;
  meta: RunMeta;
  result: SimResult;
  sceneRef: React.RefObject<Scene3DHandle>;
  chartRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
}

type ExportState = "idle" | "capturing" | "uploading" | "done" | "error";

export default function ExportSimulationButton({ config, meta, result, sceneRef, chartRefs }: ExportSimulationButtonProps) {
  const [state, setState] = useState<ExportState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleExport() {
    setState("capturing");
    setErrorMsg(null);
    try {
      const chartImages = await Promise.all(
        Object.entries(chartRefs.current).map(async ([title, el]) => {
          const svg = el?.querySelector("svg");
          if (!svg) return null;
          const raw = await svgElementToPngDataUrl(svg as SVGSVGElement, 1.5);
          const dataUrl = await downscaleDataUrl(raw, 900);
          return { title, dataUrl };
        })
      );

      const rawScene3d = sceneRef.current?.captureDataUrl() ?? null;
      const scene3dDataUrl = rawScene3d ? await downscaleDataUrl(rawScene3d, 1100) : null;

      const doc = buildTrajectoryReportPdf({
        config,
        meta,
        result,
        chartImages: chartImages.filter((c): c is { title: string; dataUrl: string } => !!c),
        scene3dDataUrl,
      });

      setState("uploading");
      const blob = doc.output("blob");
      const title = reportTitle(meta);
      const fileName = `${title.replace(/[\\/:*?"<>|]/g, "-")}.pdf`;
      const formData = new FormData();
      formData.append("file", blob, fileName);
      formData.append("title", title);
      formData.append("category", TRAJECTORY_SIMULATION_REPORT_CATEGORY);
      if (meta.siteId) formData.append("siteId", meta.siteId);
      formData.append("tags", "Trajectory Simulation");

      await uploadDocument(formData);
      setState("done");
      setTimeout(() => setState("idle"), 3000);
    } catch (err) {
      console.error(err);
      setErrorMsg(err instanceof Error ? err.message : "Export failed");
      setState("error");
    }
  }

  const labels: Record<ExportState, string> = {
    idle: "Export Simulation",
    capturing: "Capturing Graphs...",
    uploading: "Uploading to Documentation Library...",
    done: "Exported ✓",
    error: "Export Failed — Retry",
  };

  return (
    <div className="flex items-center gap-2">
      {errorMsg && state === "error" && <span className="text-[10px] text-aat-nogo">{errorMsg}</span>}
      <button
        onClick={handleExport}
        disabled={state === "capturing" || state === "uploading"}
        className="border border-zinc-700 px-2.5 py-1.5 text-xs font-semibold text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 disabled:opacity-50"
      >
        {labels[state]}
      </button>
    </div>
  );
}
