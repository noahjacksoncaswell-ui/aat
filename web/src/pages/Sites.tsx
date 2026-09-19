import React, { useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addSitePhoto, createSite, fetchCoas, fetchSite, fetchSiteWeather, fetchSites, updateSite } from "../api/resources";
import type { Site } from "../types";
import { usePreferences } from "../context/PreferencesContext";
import { formatTimestamp } from "../utils/time";
import { StatusPill, coaStatusTone } from "../components/StatusPill";
import { RequireRole } from "../components/RequireRole";

// Leaflet's default marker icons reference files that don't resolve under
// bundlers; point them at CDN-hosted assets instead.
const defaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const TILE_LAYERS = {
  street: {
    label: "Street",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
  },
  satellite: {
    label: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
  },
  topo: {
    label: "Topographic",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap",
  },
};

function FlyToSite({ site }: { site: Site | undefined }) {
  const map = useMap();
  React.useEffect(() => {
    if (site) map.flyTo([site.lat, site.lon], 11, { duration: 0.6 });
  }, [site, map]);
  return null;
}

export default function Sites() {
  const { siteId } = useParams();
  const navigate = useNavigate();
  const { data: sites } = useQuery({ queryKey: ["sites"], queryFn: fetchSites });
  const [layer, setLayer] = useState<keyof typeof TILE_LAYERS>("street");
  const [showNewSite, setShowNewSite] = useState(false);

  const selectedSite = sites?.find((s) => s.id === siteId);

  return (
    <div className="flex h-full">
      <div className="relative flex-1">
        <div className="absolute left-4 top-4 z-[1000] flex gap-1 rounded-lg bg-white/95 p-1 shadow-md dark:bg-slate-900/95">
          {Object.entries(TILE_LAYERS).map(([key, cfg]) => (
            <button
              key={key}
              onClick={() => setLayer(key as keyof typeof TILE_LAYERS)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                layer === key ? "bg-white text-black" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              {cfg.label}
            </button>
          ))}
        </div>
        <RequireRole roles={["ADMIN"]}>
          <button
            onClick={() => setShowNewSite(true)}
            className="absolute right-4 top-4 z-[1000] rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-black shadow-md hover:bg-zinc-200"
          >
            + New Site
          </button>
        </RequireRole>
        <MapContainer center={[34.5, -84.5]} zoom={7} className="h-full w-full">
          <TileLayer url={TILE_LAYERS[layer].url} attribution={TILE_LAYERS[layer].attribution} />
          {sites?.map((site) => (
            <Marker
              key={site.id}
              position={[site.lat, site.lon]}
              icon={defaultIcon}
              eventHandlers={{ click: () => navigate(`/sites/${site.id}`) }}
            >
              <Popup>
                <div className="font-semibold">{site.name}</div>
                <div className="text-xs">{site.designator}</div>
              </Popup>
            </Marker>
          ))}
          <FlyToSite site={selectedSite} />
        </MapContainer>
      </div>
      {siteId && <SiteDetailPanel siteId={siteId} onClose={() => navigate("/sites")} />}
      {showNewSite && <NewSiteModal onClose={() => setShowNewSite(false)} />}
    </div>
  );
}

function SiteDetailPanel({ siteId, onClose }: { siteId: string; onClose: () => void }) {
  const { useZulu } = usePreferences();
  const qc = useQueryClient();
  const { data: site } = useQuery({ queryKey: ["site", siteId], queryFn: () => fetchSite(siteId) });
  const { data: weather, refetch: refetchWeather, isFetching: weatherLoading } = useQuery({
    queryKey: ["site-weather", siteId],
    queryFn: () => fetchSiteWeather(siteId),
    refetchInterval: 5 * 60_000,
  });
  const { data: coas } = useQuery({ queryKey: ["coas", siteId], queryFn: () => fetchCoas(siteId) });
  const [photoUrl, setPhotoUrl] = useState("");
  const [editing, setEditing] = useState(false);

  const addPhoto = useMutation({
    mutationFn: () => addSitePhoto(siteId, photoUrl),
    onSuccess: () => {
      setPhotoUrl("");
      qc.invalidateQueries({ queryKey: ["site", siteId] });
    },
  });

  const bestCoaStatus = useMemo(() => {
    if (!coas || coas.length === 0) return "NOT_ON_FILE";
    if (coas.some((c) => c.status === "ACTIVE")) return "ACTIVE";
    if (coas.some((c) => c.status === "PENDING")) return "PENDING";
    return "EXPIRED";
  }, [coas]);

  if (!site) return <div className="w-[420px] border-l border-zinc-800 bg-black p-6">Loading...</div>;

  return (
    <div className="flex w-[420px] shrink-0 flex-col overflow-y-auto border-l border-zinc-800 bg-black">
      <div className="flex items-start justify-between border-b border-slate-200 p-5 dark:border-slate-800">
        <div>
          <div className="text-lg font-bold">{site.name}</div>
          <div className="font-mono text-xs text-slate-500 dark:text-slate-400">{site.designator}</div>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
          CLOSE
        </button>
      </div>

      <div className="space-y-5 p-5">
        <div className="flex flex-wrap gap-2">
          <StatusPill tone={site.status === "ACTIVE" ? "go" : site.status === "DECOMMISSIONED" ? "nogo" : "caution"}>
            {site.status.replace("_", " ")}
          </StatusPill>
          <StatusPill tone={coaStatusTone(bestCoaStatus)}>COA: {bestCoaStatus.replace("_", " ")}</StatusPill>
          <span className="status-pill status-neutral">{site.type.replace("_", " ")}</span>
          <span className="status-pill status-neutral">{site.ownership === "THIRD_PARTY_LEASED" ? "THIRD-PARTY LEASED" : "COMPANY-OWNED"}</span>
          {site.ownership === "THIRD_PARTY_LEASED" && (
            <StatusPill tone={site.landownerAuthorizationStatus === "ON_FILE" ? "go" : "nogo"}>
              Landowner Authorization: {site.landownerAuthorizationStatus === "ON_FILE" ? "ON FILE" : "NOT ON FILE"}
            </StatusPill>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <Field label="Coordinates" value={`${site.lat.toFixed(4)}, ${site.lon.toFixed(4)}`} />
          <Field label="Elevation" value={site.elevationMeters != null ? `${site.elevationMeters} m MSL` : "--"} />
          <Field label="Ownership notes" value={site.ownershipNotes || "--"} span2 />
          <Field label="Jurisdiction" value={site.jurisdictionNotes || "--"} span2 />
        </div>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Live Weather</div>
            <button
              onClick={() => refetchWeather()}
              disabled={weatherLoading}
              className="text-xs font-semibold text-aat-accent hover:underline disabled:opacity-50"
            >
              {weatherLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          {weather && weather.source !== "UNAVAILABLE" ? (
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
              <Field label="Temp" value={weather.temperatureC != null ? `${weather.temperatureC.toFixed(1)} °C` : "--"} />
              <Field
                label="Wind"
                value={weather.windSpeedKts != null ? `${weather.windSpeedKts.toFixed(0)} kt @ ${weather.windDirectionDeg ?? "--"}°` : "--"}
              />
              <Field label="Gusts" value={weather.windGustKts != null ? `${weather.windGustKts.toFixed(0)} kt` : "--"} />
              <Field label="Ceiling" value={weather.cloudCeilingFt != null ? `${weather.cloudCeilingFt.toFixed(0)} ft` : "--"} />
              <Field label="Visibility" value={weather.visibilityMi != null ? `${weather.visibilityMi.toFixed(1)} mi` : "--"} />
              <Field label="Pressure" value={weather.barometricPressureHpa != null ? `${weather.barometricPressureHpa.toFixed(0)} hPa` : "--"} />
              <Field label="Precip Prob." value={weather.precipitationProbabilityPct != null ? `${weather.precipitationProbabilityPct}%` : "--"} />
              <Field label="Source" value={`${weather.source} · ${formatTimestamp(weather.fetchedAt, useZulu)}`} span2 />
              {weather.shortForecast && <Field label="Forecast" value={weather.shortForecast} span2 />}
            </div>
          ) : (
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
              Weather data unavailable for this site.
            </div>
          )}
        </section>

        <section>
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Terrain & Geography</div>
          <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
            <Field label="Terrain" value={site.terrainType || "--"} />
            <Field label="Nearest population centers" value={site.nearestPopulationCenters || "--"} />
            <Field label="Nearest water bodies" value={site.nearestWaterBodies || "--"} />
          </div>
        </section>

        <section className="flex gap-2">
          <Link
            to={`/faa`}
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-center text-xs font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            FAA Authorization →
          </Link>
          <Link
            to={`/documents?siteId=${site.id}`}
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-center text-xs font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Site Documents →
          </Link>
        </section>

        <section>
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Photo Gallery</div>
          <div className="grid grid-cols-3 gap-2">
            {site.photos?.map((p) => (
              <img key={p.id} src={p.url} alt={p.caption ?? ""} className="h-20 w-full rounded-md object-cover" />
            ))}
          </div>
          <RequireRole roles={["ADMIN", "LAUNCH_DIRECTOR"]}>
            <div className="mt-2 flex gap-2">
              <input
                value={photoUrl}
                onChange={(e) => setPhotoUrl(e.target.value)}
                placeholder="Image URL"
                className="flex-1 rounded-md border border-slate-300 bg-transparent px-2 py-1 text-xs dark:border-slate-700"
              />
              <button
                onClick={() => photoUrl && addPhoto.mutate()}
                className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-black"
              >
                Add
              </button>
            </div>
          </RequireRole>
        </section>

        <RequireRole roles={["ADMIN"]}>
          <button onClick={() => setEditing((e) => !e)} className="text-xs font-semibold text-aat-accent hover:underline">
            {editing ? "Cancel edit" : "Edit site details"}
          </button>
          {editing && <EditSiteForm site={site} onDone={() => setEditing(false)} />}
        </RequireRole>
      </div>
    </div>
  );
}

function Field({ label, value, span2 }: { label: string; value: React.ReactNode; span2?: boolean }) {
  return (
    <div className={span2 ? "col-span-2" : ""}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function EditSiteForm({ site, onDone }: { site: Site; onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    status: site.status,
    ownership: site.ownership ?? "COMPANY_OWNED",
    ownershipNotes: site.ownershipNotes ?? "",
    jurisdictionNotes: site.jurisdictionNotes ?? "",
    terrainType: site.terrainType ?? "",
    nearestPopulationCenters: site.nearestPopulationCenters ?? "",
    nearestWaterBodies: site.nearestWaterBodies ?? "",
  });
  const mutation = useMutation({
    mutationFn: () => updateSite(site.id, form as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["site", site.id] });
      qc.invalidateQueries({ queryKey: ["sites"] });
      onDone();
    },
  });

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <select
        value={form.status}
        onChange={(e) => setForm({ ...form, status: e.target.value as any })}
        className="w-full rounded-md border border-slate-300 bg-transparent px-2 py-1 text-xs dark:border-slate-700"
      >
        {["ACTIVE", "STANDBY", "UNDER_CONSTRUCTION", "DECOMMISSIONED"].map((s) => (
          <option key={s} value={s}>
            {s.replace("_", " ")}
          </option>
        ))}
      </select>
      <select
        value={form.ownership}
        onChange={(e) => setForm({ ...form, ownership: e.target.value as any })}
        className="w-full rounded-md border border-slate-300 bg-transparent px-2 py-1 text-xs dark:border-slate-700"
      >
        {["COMPANY_OWNED", "THIRD_PARTY_LEASED"].map((o) => (
          <option key={o} value={o}>
            {o.replace(/_/g, " ")}
          </option>
        ))}
      </select>
      {(
        [
          ["ownershipNotes", "Ownership notes"],
          ["jurisdictionNotes", "Jurisdiction notes"],
          ["terrainType", "Terrain type"],
          ["nearestPopulationCenters", "Nearest population centers"],
          ["nearestWaterBodies", "Nearest water bodies"],
        ] as const
      ).map(([key, label]) => (
        <input
          key={key}
          value={(form as any)[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          placeholder={label}
          className="w-full rounded-md border border-slate-300 bg-transparent px-2 py-1 text-xs dark:border-slate-700"
        />
      ))}
      <button onClick={() => mutation.mutate()} className="w-full rounded-md bg-white py-1.5 text-xs font-semibold text-black">
        Save
      </button>
    </div>
  );
}

function NewSiteModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    designator: "",
    lat: "",
    lon: "",
    elevationMeters: "",
    type: "FIXED_PAD",
    status: "STANDBY",
    ownership: "COMPANY_OWNED",
  });
  const mutation = useMutation({
    mutationFn: () =>
      createSite({
        name: form.name,
        designator: form.designator,
        lat: Number(form.lat),
        lon: Number(form.lon),
        elevationMeters: form.elevationMeters ? Number(form.elevationMeters) : null,
        type: form.type as any,
        status: form.status as any,
        ownership: form.ownership as any,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sites"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-black p-6">
        <h2 className="mb-4 text-lg font-bold">New Launch Site</h2>
        <div className="space-y-3">
          <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" />
          <input
            placeholder="Designator (e.g. AAT-LC3)"
            value={form.designator}
            onChange={(e) => setForm({ ...form, designator: e.target.value })}
            className="input"
          />
          <div className="grid grid-cols-2 gap-2">
            <input placeholder="Latitude" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} className="input" />
            <input placeholder="Longitude" value={form.lon} onChange={(e) => setForm({ ...form, lon: e.target.value })} className="input" />
          </div>
          <input
            placeholder="Elevation (m MSL)"
            value={form.elevationMeters}
            onChange={(e) => setForm({ ...form, elevationMeters: e.target.value })}
            className="input"
          />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="input">
            {["FIXED_PAD", "MOBILE_TEL", "MARINE_PLATFORM", "OTHER"].map((t) => (
              <option key={t} value={t}>
                {t.replace("_", " ")}
              </option>
            ))}
          </select>
          <select value={form.ownership} onChange={(e) => setForm({ ...form, ownership: e.target.value })} className="input">
            {["COMPANY_OWNED", "THIRD_PARTY_LEASED"].map((o) => (
              <option key={o} value={o}>
                {o.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!form.name || !form.designator || !form.lat || !form.lon}
            className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
          >
            Create Site
          </button>
        </div>
      </div>
    </div>
  );
}
