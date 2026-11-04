import { describe, expect, it } from "vitest";
import type { MembershipContext, Sport } from "@/api/types";
import { moreFor, navFor, profileLinksFor, tabsFor } from "@/components/shell/nav";
import { anyClubHas, has, testsFor } from "./features";

const club = (...modalities: Sport[]) => ({ modalities });
const runOnly = club("run"), functional = club("mobility"), mixed = club("run", "mobility"), pool = club("swim");
const labels = (role: "owner" | "trainer" | "student", c: { modalities: Sport[] }) => navFor(role, c.modalities).flatMap((g) => g.items.map((i) => i.label));

describe("features (D-052)", () => {
  it("a club sees a feature when one of its modalities uses it", () => {
    expect(has(runOnly, "strava")).toBe(true);
    expect(has(runOnly, "exercises")).toBe(false);
    expect(has(runOnly, "classes")).toBe(false);
    expect(has(functional, "classes")).toBe(true);
    expect(has(functional, "exercises")).toBe(true);
    expect(has(functional, "strava")).toBe(false);
    expect(has(functional, "races")).toBe(false);
    expect(has(functional, "zones")).toBe(false);
    expect(has(pool, "classes")).toBe(true); // natação with aulas (founder, 2026-11-04)
    expect(has(pool, "zones")).toBe(true);
    expect(has(mixed, "strava") && has(mixed, "exercises") && has(mixed, "classes")).toBe(true);
    expect(has(null, "strava")).toBe(false);
  });

  it("Perfil asks every active club of the person", () => {
    const m = (status: "active" | "left", ...modalities: Sport[]) => ({ membership: { status }, club: { modalities } }) as unknown as MembershipContext;
    expect(anyClubHas([m("active", "mobility"), m("active", "run")], "strava")).toBe(true);
    expect(anyClubHas([m("active", "mobility"), m("left", "run")], "strava")).toBe(false);
    expect(anyClubHas([], "races")).toBe(false);
  });

  it("Avaliações lists only the tests of the club's modalities", () => {
    const all = ["body", "cooper", "run_3k", "css", "ftp", "one_rm", "hr_max"] as const;
    expect(testsFor(runOnly, all)).toEqual(["body", "cooper", "run_3k", "hr_max"]);
    expect(testsFor(functional, all)).toEqual(["body", "one_rm"]);
    expect(testsFor(pool, all)).toEqual(["body", "css", "hr_max"]);
    expect(testsFor(mixed, all)).toEqual(["body", "cooper", "run_3k", "one_rm", "hr_max"]);
  });

  it("the nav follows the club's modalities for every role", () => {
    expect(labels("owner", runOnly)).toContain("Provas");
    expect(labels("owner", runOnly)).not.toContain("Exercícios");
    expect(labels("owner", functional)).toContain("Exercícios");
    expect(labels("owner", functional)).not.toContain("Provas");
    expect(labels("trainer", functional)).not.toContain("Provas");
    expect(navFor("trainer", functional.modalities).map((g) => g.title)).not.toContain("Equipe"); // empty group dropped
    expect(labels("owner", mixed)).toEqual(expect.arrayContaining(["Exercícios", "Provas", "Avaliações"]));
    expect(labels("student", functional)).not.toContain("Atividades");
    expect(labels("student", runOnly)).toEqual(expect.arrayContaining(["Atividades", "Provas"]));
    expect(tabsFor("student", functional.modalities).map((i) => i.label)).toEqual(["Hoje", "Agenda", "Mensagens", "Perfil"]);
    expect(moreFor("trainer", functional.modalities).map((i) => i.label)).not.toContain("Provas");
  });

  it("Perfil's links come from the person's clubs, and all of them without memberships (routing)", () => {
    const only = (...modalities: Sport[]) => [{ membership: { status: "active" }, club: { modalities } } as unknown as MembershipContext];
    expect(profileLinksFor("student", only("mobility")).map((i) => i.label)).toEqual([]);
    expect(profileLinksFor("student", only("run")).map((i) => i.label)).toEqual(["Provas", "Atividades"]);
    expect(profileLinksFor("student").map((i) => i.label)).toEqual(["Provas", "Atividades"]);
  });
});
