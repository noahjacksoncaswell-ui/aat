import React from "react";
import { enuToLatLon } from "../../lib/trajectory/geo";
import type { RunMeta } from "../../lib/trajectory/formConfig";
import type { TimeSeriesPoint } from "../../lib/trajectory/types";

// v6.0 Section 6.3 - Predicted Landing Table.
export interface PredictedLandingTableProps {
  touchdown: TimeSeriesPoint;
  meta: RunMeta;
}

export default function PredictedLandingTable({ touchdown, meta }: PredictedLandingTableProps) {
  const { lat, lon } = enuToLatLon(meta.origin.lat, meta.origin.lon, touchdown.xEastM, touchdown.yNorthM);
  const straightLineM = Math.hypot(touchdown.xEastM, touchdown.yNorthM);
  const coaRadiusM = meta.activeCoa ? meta.activeCoa.authorizedOperationRadiusNm * 1852 : null;
  const withinCoa = coaRadiusM != null ? straightLineM <= coaRadiusM : null;

  return (
    <section className="card overflow-x-auto p-4">
      <div className="mb-3 text-xs font-bold uppercase tracking-wide text-zinc-400">Predicted Landing</div>
      <table className="w-full text-left text-xs">
        <tbody className="font-mono">
          <Row label="Touchdown Coordinates" value={`${lat.toFixed(5)}, ${lon.toFixed(5)}`} />
          <Row label="Downrange Distance" value={`${touchdown.downrangeM.toFixed(1)} m`} />
          <Row label="Crossrange Drift" value={`${touchdown.crossrangeM.toFixed(1)} m`} />
          <Row label="Straight-Line Distance from Launch Site" value={`${straightLineM.toFixed(1)} m`} />
          <Row
            label="Within COA Authorized Operation Radius"
            value={withinCoa == null ? "N/A — No Active COA On File" : withinCoa ? "Yes" : "No"}
          />
        </tbody>
      </table>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-zinc-900">
      <td className="py-1.5 pr-4 font-sans uppercase text-zinc-500">{label}</td>
      <td className="py-1.5">{value}</td>
    </tr>
  );
}
