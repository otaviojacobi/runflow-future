import { describe, expect, it } from "vitest";
import type { Structure } from "@/domain/workout";
import { encodeFitWorkout, fitCrc } from "./fit";

/** Walk the FIT records and return the data messages per global message number. */
function decode(file: Uint8Array) {
  const dv = new DataView(file.buffer);
  const headerSize = file[0]!, dataSize = dv.getUint32(4, true);
  const defs = new Map<number, { global: number; fields: [number, number][] }>();
  const msgs: { global: number; values: Map<number, Uint8Array> }[] = [];
  let p = headerSize;
  while (p < headerSize + dataSize) {
    const h = file[p++]!, local = h & 0x0f;
    if (h & 0x40) {
      const global = dv.getUint16(p + 2, true), n = file[p + 4]!;
      const fields: [number, number][] = [];
      for (let i = 0; i < n; i++) fields.push([file[p + 5 + i * 3]!, file[p + 6 + i * 3]!]);
      defs.set(local, { global, fields });
      p += 5 + n * 3;
    } else {
      const d = defs.get(local)!;
      const values = new Map<number, Uint8Array>();
      for (const [num, size] of d.fields) { values.set(num, file.slice(p, p + size)); p += size; }
      msgs.push({ global: d.global, values });
    }
  }
  return { headerSize, dataSize, msgs };
}

const STRUCT: Structure = { v: 1, blocks: [
  { kind: "step", intent: "warmup", duration: { type: "time", s: 600 }, target: { type: "zone", metric: "hr", zone: 2 } },
  { kind: "repeat", count: 6, steps: [
    { kind: "step", intent: "active", duration: { type: "distance", m: 1000 }, target: { type: "pace", min_s: 265, max_s: 275 } },
    { kind: "step", intent: "recovery", duration: { type: "time", s: 120 }, target: { type: "open" } }] },
  { kind: "step", intent: "cooldown", duration: { type: "time", s: 600 }, target: { type: "open" } },
] };

describe("FIT workout", () => {
  const file = encodeFitWorkout("Intervalado 6×1 km", "run", STRUCT, () => "", new Date("2026-11-02T12:00:00Z"));
  const { headerSize, dataSize, msgs } = decode(file);
  it("has a valid header, size and CRC", () => {
    expect(headerSize).toBe(14);
    expect(String.fromCharCode(...file.slice(8, 12))).toBe(".FIT");
    expect(dataSize).toBe(file.length - 16);
    expect(fitCrc(file)).toBe(0); // CRC over the whole file including its CRC is zero
  });
  it("writes file_id (workout), workout and the flattened steps", () => {
    expect(msgs.filter((m) => m.global === 0)).toHaveLength(1);
    expect(msgs.find((m) => m.global === 0)!.values.get(0)![0]).toBe(5);
    const steps = msgs.filter((m) => m.global === 27);
    expect(steps).toHaveLength(5); // warmup, active, recovery, repeat, cooldown
    const repeat = steps[3]!.values;
    expect(repeat.get(1)![0]).toBe(6); // repeat_until_steps_cmplt
    expect(new DataView(repeat.get(2)!.buffer).getUint32(0, true)).toBe(1); // from step index 1
    expect(new DataView(repeat.get(4)!.buffer).getUint32(0, true)).toBe(6); // 6 times
    const active = steps[1]!.values;
    expect(new DataView(active.get(2)!.buffer).getUint32(0, true)).toBe(100000); // 1000 m in cm
    expect(new DataView(active.get(5)!.buffer).getUint32(0, true)).toBe(Math.round(1e6 / 275)); // slower bound = low speed
    const workout = msgs.find((m) => m.global === 26)!.values;
    expect(new TextDecoder().decode(workout.get(8)!).replace(/\0+$/, "")).toBe("Intervalado 6×1 km");
  });
});
