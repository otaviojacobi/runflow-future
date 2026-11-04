// @vitest-environment jsdom
/**
 * Regression (2026-11-04): WelcomeScreen called useState after `if (!me || !club) return null`, so when `/me` arrived
 * after the first render React threw "Rendered more hooks than during the previous render" (Rules of Hooks). This
 * renders it without a club, then with one: both renders must succeed.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state: { me: unknown; club: unknown; ctx: unknown } = { me: null, club: null, ctx: null };
const idle = { mutate: vi.fn(), isPending: false, error: null };

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/lib/club", () => ({ useClub: () => state }));
vi.mock("@/api/account", () => ({
  useConnections: () => ({ data: [] }), useConsents: () => ({ data: [] }), useGrantConsent: () => idle, useUpdateMe: () => idle,
}));
vi.mock("@/components/account/StravaConnect", () => ({ ProviderConnections: () => null }));
vi.mock("@/components/brand", () => ({ ClubLogo: () => null }));

const { WelcomeScreen } = await import("./Welcome");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); Object.assign(state, { me: null, club: null, ctx: null }); });

describe("WelcomeScreen", () => {
  it("renders once /me arrives after a first render without it (same hooks both times)", () => {
    act(() => root.render(createElement(WelcomeScreen)));
    expect(host.textContent).toBe("");
    const club = { id: "c1", name: "Pace Forte", modalities: ["run"], trainer_label: "treinador" };
    Object.assign(state, {
      me: { user: { id: "u1", name: "Ana Souza", birth_date: null, phone: null }, memberships: [] },
      club, ctx: { club, membership: { id: "m1", role: "student", status: "active" } },
    });
    act(() => root.render(createElement(WelcomeScreen)));
    expect(host.textContent).toContain("Pace Forte");
  });
});
