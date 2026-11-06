/**
 * The route map's page for the app's web view (components/RouteMap.tsx): no React Native imports, so the exact page
 * can be tried in a browser. Load it with the CDN as its base URL: MapLibre starts its worker from a file next to
 * itself, which a page may only do from its own origin.
 */
export const routeMapCdn = (version: string) => `https://cdn.jsdelivr.net/npm/maplibre-gl@${version}/dist`;

/** The page: MapLibre fitted to the route, its line over a casing, start and end dots; posts "ready" or "error". */
export function routeMapPage(version: string, data: unknown): string {
  const CDN = routeMapCdn(version);
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="${CDN}/maplibre-gl.css"><style>html,body,#m{margin:0;height:100%;background:transparent}</style></head>
<body><div id="m"></div><script type="module">
const d = ${json};
const say = (m) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(m);
try {
  const { Map } = await import("${CDN}/maplibre-gl.mjs");
  const map = new Map({ container: "m", style: d.style, bounds: d.bounds, fitBoundsOptions: { padding: d.pad }, interactive: false, attributionControl: false });
  const fit = () => map.fitBounds(d.bounds, { padding: d.pad, animate: false });
  map.on("resize", fit);
  map.on("load", () => {
    fit();
    const round = { "line-join": "round", "line-cap": "round" };
    map.addSource("route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: d.line } } });
    map.addSource("ends", { type: "geojson", data: { type: "FeatureCollection", features: [d.line[0], d.line[d.line.length - 1]].map((c, i) => ({ type: "Feature", properties: { end: i }, geometry: { type: "Point", coordinates: c } })) } });
    map.addLayer({ id: "casing", type: "line", source: "route", layout: round, paint: { "line-color": d.surface, "line-width": 7 } });
    map.addLayer({ id: "route", type: "line", source: "route", layout: round, paint: { "line-color": d.brand, "line-width": 4 } });
    map.addLayer({ id: "ends", type: "circle", source: "ends", paint: { "circle-radius": 6, "circle-color": ["case", ["==", ["get", "end"], 0], d.start, d.end], "circle-stroke-color": d.surface, "circle-stroke-width": 2 } });
    map.once("idle", () => say("ready"));
  });
  map.on("error", (e) => { if (!map.loaded()) say("error"); });
} catch (e) { say("error"); }
</script></body></html>`;
}
