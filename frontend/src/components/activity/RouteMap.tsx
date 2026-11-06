/** The route on a real map (founder, 2026-11-06): MapLibre over OpenFreeMap (free, no key; the map credits
 * OpenStreetMap: MapCredit). Loaded on demand by the Percurso card, which shows the plain drawing until `onReady`: offline,
 * without WebGL or when the map service fails, the drawing simply stays. A still picture (no panning), so the page
 * scrolls over it on phones. Colors are the theme's tokens, read from the page. */
import { Map as MapLibre, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre's tile worker, bundled by Vite: its own lookup of the file next to the library breaks in Vite's builds.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useRef, useState } from "react";
import { MAP_STYLES, routeGeo } from "@/domain/activity";
import { t } from "@/i18n";
import { cn } from "@/ui";

setWorkerUrl(workerUrl);

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const dark = () => {
  const mode = document.documentElement.getAttribute("data-theme");
  return mode ? mode === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
};

export default function RouteMap({ points, onReady }: { points: [number, number][]; onReady: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const geo = routeGeo(points);
    if (!geo || !el.current) return;
    let map: MapLibre;
    try {
      map = new MapLibre({
        container: el.current,
        style: dark() ? MAP_STYLES.dark : MAP_STYLES.light,
        bounds: geo.bounds,
        fitBoundsOptions: { padding: 24 },
        interactive: false,
        // The credit is a line under the map (MapCredit): the control covered half of a phone-sized map.
        attributionControl: false,
        locale: { "Map.Title": t("Mapa do percurso") },
      });
    } catch {
      return; // no WebGL: the drawing stays
    }
    // Fitted again on every resize: the card can still be settling its size when the map loads.
    const fit = () => map.fitBounds(geo.bounds, { padding: 24, animate: false });
    map.on("resize", fit);
    map.on("load", () => {
      fit();
      const brand = token("--color-brand-text"), surface = token("--color-surface");
      const [start, end] = [geo.line[0]!, geo.line[geo.line.length - 1]!];
      map.addSource("route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: geo.line } } });
      map.addSource("ends", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [start, end].map((c, i) => ({ type: "Feature", properties: { end: i }, geometry: { type: "Point", coordinates: c } })) },
      });
      const round = { "line-join": "round", "line-cap": "round" } as const;
      map.addLayer({ id: "route-casing", type: "line", source: "route", layout: round, paint: { "line-color": surface, "line-width": 7 } });
      map.addLayer({ id: "route", type: "line", source: "route", layout: round, paint: { "line-color": brand, "line-width": 4 } });
      map.addLayer({
        id: "ends", type: "circle", source: "ends",
        paint: { "circle-radius": 6, "circle-color": ["case", ["==", ["get", "end"], 0], token("--color-success"), token("--color-danger")], "circle-stroke-color": surface, "circle-stroke-width": 2 },
      });
      map.once("idle", () => { setReady(true); onReady(); });
    });
    return () => map.remove();
  }, [points, onReady]);
  return <div ref={el} className={cn("absolute inset-0 transition-opacity duration-150 ease-standard", !ready && "opacity-0")} />;
}

/** The map's required credit (OpenFreeMap, OpenMapTiles, OpenStreetMap), shown under it. */
export function MapCredit() {
  const a = "underline-offset-2 hover:underline";
  return (
    <span className="text-xs text-fg-subtle">
      <a className={a} href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a>{" © "}
      <a className={a} href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a>{" · "}
      {t("dados")} <a className={a} href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
    </span>
  );
}
