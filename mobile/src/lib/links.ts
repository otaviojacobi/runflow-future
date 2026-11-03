/**
 * In-app links (notification `link`s, alert links): API links are web paths ("/workouts/abc", "/messages?c=1"), and
 * the app's routes mirror the web's paths. A path that some screen in the app matches opens here; the rest (desktop
 * tools like "/club/billing") opens the web app. The routes come from Expo Router's own route tree, so a screen
 * added in a later step (X4's workout, X8's student) starts receiving its links without touching this file.
 */
import { router, useSitemap, type Href, type SitemapType } from "expo-router";
import { useMemo } from "react";
import { openOnWeb } from "./web";

const SKIP = /^(\+|_)/; // +not-found, +html, _sitemap, _layout…
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One regular expression per screen file: groups dropped, `index` erased, `[id]` = one segment, `[...rest]` = many. */
export function routePatterns(node: SitemapType | null): RegExp[] {
  if (!node) return [];
  const out: RegExp[] = [];
  const walk = (n: SitemapType) => {
    if (n.children.length) { n.children.forEach(walk); return; }
    if (n.isInternal || n.isGenerated) return;
    const segs = n.contextKey.replace(/^\.\//, "").replace(/(\.(web|native|ios|android))?\.[jt]sx?$/, "").split("/");
    if (segs.some((s) => SKIP.test(s))) return;
    const parts = segs.filter((s) => !/^\(.+\)$/.test(s) && s !== "index").map((s) => {
      if (/^\[\.\.\..+\]$/.test(s)) return ".+";
      if (/^\[.+\]$/.test(s)) return "[^/]+";
      return escape(s);
    });
    out.push(new RegExp(`^/${parts.join("/")}$`));
  };
  walk(node);
  return out;
}

/** The path part of a link, without query, hash or trailing slash. */
export const pathOf = (link: string) => link.split(/[?#]/)[0]!.replace(/(.)\/+$/, "$1");

/** `(link) => Href` when a screen in the app opens it, else null (open it on the web). Only same-app paths count. */
export function useAppLink() {
  const sitemap = useSitemap();
  const patterns = useMemo(() => routePatterns(sitemap), [sitemap]);
  return (link: string | null | undefined): Href | null => {
    if (!link || !link.startsWith("/") || link.startsWith("//")) return null;
    const path = pathOf(link);
    return patterns.some((r) => r.test(path)) ? (link as Href) : null;
  };
}

/** `(link) => void`: opens a link in the app when a screen matches it, else on the web (dashboard alerts, checklists). */
export function useOpenLink() {
  const appLink = useAppLink();
  return (link: string) => {
    const target = appLink(link);
    if (target) router.push(target);
    else void openOnWeb(link);
  };
}
