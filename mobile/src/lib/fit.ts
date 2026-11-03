/**
 * Minimal FIT workout encoder (Garmin FIT protocol 2.0): file_id + workout + workout_step messages. A copy of the web's
 * lib/fit.ts (keep in sync) without the browser download: the app hands the bytes to the share sheet (lib/files).
 * Copy the .fit to the watch's GARMIN/NewFiles folder (most Garmin devices), or import it in apps that accept FIT workouts.
 */
import type { Sport } from "@/api/types";
import type { Block, Step, Structure, Target } from "@/domain/workout";

const CRC_TABLE = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];
export function fitCrc(bytes: Uint8Array, start = 0, end = bytes.length) {
  let crc = 0;
  for (let i = start; i < end; i++) {
    const b = bytes[i]!;
    let tmp = CRC_TABLE[crc & 0xf]!; crc = (crc >> 4) & 0x0fff; crc = crc ^ tmp ^ CRC_TABLE[b & 0xf]!;
    tmp = CRC_TABLE[crc & 0xf]!; crc = (crc >> 4) & 0x0fff; crc = crc ^ tmp ^ CRC_TABLE[(b >> 4) & 0xf]!;
  }
  return crc;
}

// Base types
const ENUM = 0x00, UINT16 = 0x84, UINT32 = 0x86, UINT32Z = 0x8c, STRING = 0x07;
const NAME_BYTES = 32;
type Field = [num: number, size: number, type: number];
const FILE_ID: Field[] = [[0, 1, ENUM], [1, 2, UINT16], [2, 2, UINT16], [3, 4, UINT32Z], [4, 4, UINT32]];
const WORKOUT: Field[] = [[8, NAME_BYTES, STRING], [4, 1, ENUM], [6, 2, UINT16]];
const STEP: Field[] = [[254, 2, UINT16], [0, NAME_BYTES, STRING], [1, 1, ENUM], [2, 4, UINT32], [3, 1, ENUM], [4, 4, UINT32], [5, 4, UINT32], [6, 4, UINT32], [7, 1, ENUM]];
const INVALID32 = 0xffffffff, INVALID8 = 0xff;
const SPORT: Record<Sport, number> = { run: 1, bike: 2, swim: 5, strength: 10, mobility: 10, other: 0 };
const INTENSITY: Record<Step["intent"], number> = { active: 0, rest: 1, warmup: 2, cooldown: 3, recovery: 4, other: 0 };

class Writer {
  private chunks: number[] = [];
  u8(v: number) { this.chunks.push(v & 0xff); }
  u16(v: number) { this.u8(v); this.u8(v >> 8); }
  u32(v: number) { this.u16(v & 0xffff); this.u16((v >>> 16) & 0xffff); }
  str(s: string, size: number) {
    const bytes = new TextEncoder().encode(s);
    let n = Math.min(bytes.length, size - 1);
    while (n > 0 && (bytes[n]! & 0xc0) === 0x80) n--; // don't cut a UTF-8 sequence
    for (let i = 0; i < size; i++) this.u8(i < n ? bytes[i]! : 0);
  }
  define(local: number, global: number, fields: Field[]) {
    this.u8(0x40 | local); this.u8(0); this.u8(0); this.u16(global); this.u8(fields.length);
    for (const [num, size, type] of fields) { this.u8(num); this.u8(size); this.u8(type); }
  }
  get bytes() { return Uint8Array.from(this.chunks); }
}

interface FitStep { name: string; durationType: number; durationValue: number; targetType: number; targetValue: number; low: number; high: number; intensity: number }

function target(t: Target): Pick<FitStep, "targetType" | "targetValue" | "low" | "high"> {
  const speed = (paceS: number) => Math.round(1e6 / paceS); // m/s × 1000
  if (t.type === "pace") return { targetType: 0, targetValue: 0, low: speed(t.max_s), high: speed(t.min_s) };
  if (t.type === "hr") return { targetType: 1, targetValue: 0, low: t.min + 100, high: t.max + 100 };
  if (t.type === "power") return { targetType: 4, targetValue: 0, low: t.min + 1000, high: t.max + 1000 };
  if (t.type === "zone") {
    if (t.metric === "pace" && t.resolved?.min_s && t.resolved.max_s) return { targetType: 0, targetValue: 0, low: speed(t.resolved.max_s), high: speed(t.resolved.min_s) };
    if (t.metric === "hr") return { targetType: 1, targetValue: t.zone, low: 0, high: 0 };
    if (t.metric === "power") return { targetType: 4, targetValue: t.zone, low: 0, high: 0 };
  }
  return { targetType: 2, targetValue: 0, low: 0, high: 0 };
}
function fromStep(s: Step, label: (s: Step) => string): FitStep {
  const d = s.duration;
  return {
    name: label(s),
    durationType: d.type === "time" ? 0 : d.type === "distance" ? 1 : 5,
    durationValue: d.type === "time" ? d.s * 1000 : d.type === "distance" ? Math.round(d.m * 100) : 0,
    ...target(s.target), intensity: INTENSITY[s.intent],
  };
}

/** Flatten blocks into FIT steps; a series becomes its steps followed by a "repeat until steps complete" step. */
export function fitSteps(structure: Structure, label: (s: Step) => string): FitStep[] {
  const out: FitStep[] = [];
  const add = (b: Block) => {
    if (b.kind === "step") out.push(fromStep(b, label));
    else if (b.kind === "repeat") {
      const first = out.length;
      for (const s of b.steps) out.push(fromStep(s, label));
      out.push({ name: "", durationType: 6, durationValue: first, targetType: INVALID8, targetValue: b.count, low: INVALID32, high: INVALID32, intensity: INVALID8 });
    } else out.push({ name: `${b.name} ${b.sets}x${b.reps}`, durationType: 5, durationValue: 0, targetType: 2, targetValue: 0, low: 0, high: 0, intensity: 0 });
  };
  structure.blocks.forEach(add);
  return out;
}

export function encodeFitWorkout(name: string, sport: Sport, structure: Structure, label: (s: Step) => string, created = new Date()): Uint8Array {
  const steps = fitSteps(structure, label);
  const w = new Writer();
  w.define(0, 0, FILE_ID);
  w.u8(0); w.u8(5); w.u16(255); w.u16(0); w.u32(1); w.u32(Math.max(0, Math.floor(created.getTime() / 1000) - 631065600));
  w.define(1, 26, WORKOUT);
  w.u8(1); w.str(name, NAME_BYTES); w.u8(SPORT[sport]); w.u16(steps.length);
  w.define(2, 27, STEP);
  steps.forEach((s, i) => { w.u8(2); w.u16(i); w.str(s.name, NAME_BYTES); w.u8(s.durationType); w.u32(s.durationValue); w.u8(s.targetType); w.u32(s.targetValue); w.u32(s.low); w.u32(s.high); w.u8(s.intensity); });
  const data = w.bytes;
  const file = new Uint8Array(14 + data.length + 2);
  const hv = new DataView(file.buffer);
  file[0] = 14; file[1] = 0x20; hv.setUint16(2, 2132, true); hv.setUint32(4, data.length, true);
  file.set([0x2e, 0x46, 0x49, 0x54], 8); // ".FIT"
  hv.setUint16(12, fitCrc(file, 0, 12), true);
  file.set(data, 14);
  hv.setUint16(14 + data.length, fitCrc(file, 0, 14 + data.length), true);
  return file;
}
