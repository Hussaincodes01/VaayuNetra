// The node firmware (Vayu-node, C) compiled to WebAssembly: a whole site's network in the browser.
// Layouts mirror Vayu-node/sim/vn_sim.h and vn_sim.c; keep them in step when the firmware changes.

export const ROLE = {
  ring: 0,
  head: 1,
  anchor: 2,
  community: 3,
  background: 4,
  gateway: 5,
} as const;
export type Role = keyof typeof ROLE;

/** vn_sim_set keys (VN_K_*). */
export const K = {
  windMs: 0,
  windFrom: 1,
  temp: 2,
  rh: 3,
  pHpa: 4,
  bgPpm: 5,
  leakKgph: 6,
  leakX: 7,
  leakY: 8,
  leakStartS: 9,
  sun: 10,
  pmBg: 11,
  fireNode: 12,
  firePm: 13,
  sf: 14,
  bw: 15,
  txDbm: 16,
  plExp: 17,
  shadowDb: 18,
  heaterSwitch: 19,
  utcOffset: 20,
  panelW: 21,
  cells: 22,
  mcuMa: 23,
  soil: 24,
  dpdt: 25,
  sourceR: 26,
  drift: 27,
  gatewayDown: 28,
  fireStartS: 29,
  risePpm: 30,
} as const;

/** vn_sim_state layout, 72 doubles per node. */
export const S = {
  x: 0,
  y: 1,
  role: 2,
  alive: 3,
  on: 4,
  heaterWant: 5,
  heater: 6,
  soc: 7,
  vbat: 8,
  vsol: 9,
  truePpm: 10,
  ppm: 11,
  base: 12,
  excess: 13,
  ev: 14,
  rsOhm: 15,
  rsRatio: 16,
  ads0: 17,
  ads1: 18,
  ads2: 19,
  ads3: 20,
  vain0: 21,
  v5: 22,
  tC: 23,
  rh: 24,
  p: 25,
  rawT: 26,
  rawP: 27,
  rawH: 28,
  pm: 29,
  pmTrue: 30,
  ws: 31,
  wd: 32,
  vane: 33,
  pulses: 34,
  reports: 35,
  alarms: 36,
  txOwn: 37,
  txRelay: 38,
  rx: 39,
  dup: 40,
  supp: 41,
  backoff: 42,
  airtime: 43,
  harvest: 44,
  load: 45,
  pmsOn: 46,
  timeOk: 47,
  alarmActive: 48,
  acks: 49,
  seq: 50,
  nextReport: 51,
  metOk: 52,
  gasOk: 53,
  hasWind: 54,
  hasPms: 55,
  brownout: 56,
  bmeN: 57,
  adsN: 58,
  id: 59,
  gwLines: 60,
  haveBase: 61,
  sun: 62,
  qFull: 63,
  peak: 64,
} as const;

/** One transmission: vn_sim_tx row. */
export type Packet = {
  t0: number;
  t1: number;
  src: number;
  type: number; // 1 data, 2 alarm, 3 ack, 4 cmd, 5 time
  relay: boolean;
  len: number;
  heard: number[];
  delivered: boolean;
};

type Exports = {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  vn_sim_reset(seed: number, startUnix: number): void;
  vn_sim_add(
    role: number,
    x: number,
    y: number,
    wind: number,
    pms: number,
  ): number;
  vn_sim_set(key: number, v: number): void;
  vn_sim_get(key: number): number;
  vn_sim_kill(i: number, dead: number): void;
  vn_sim_set_soc(i: number, soc: number): void;
  vn_sim_run_until(tMs: number): void;
  vn_sim_now(): number;
  vn_sim_count(): number;
  vn_sim_state(i: number): number;
  vn_sim_buf(): number;
  vn_sim_payload(i: number): number;
  vn_sim_trace(i: number, k: number): number;
  vn_sim_lines(): number;
  vn_sim_line(k: number): number;
  vn_sim_gateway_in(len: number): number;
  vn_sim_tx_count(): number;
  vn_sim_tx(k: number): number;
  vn_sim_true_ppm_at(x: number, y: number): number;
  vn_sim_link_rssi(i: number, j: number): number;
};

let modulePromise: Promise<WebAssembly.Module> | null = null;

/** Compile the firmware once per page; every simulator is a fresh instance with its own memory. */
export function loadFirmware(): Promise<WebAssembly.Module> {
  modulePromise ??= fetch("/ground/vn_sim.wasm")
    .then((r) => {
      if (!r.ok) throw new Error(`vn_sim.wasm: HTTP ${r.status}`);
      return r.arrayBuffer();
    })
    .then((b) => WebAssembly.compile(b));
  return modulePromise;
}

const decoder = new TextDecoder();

export class GroundSim {
  private x: Exports;

  constructor(module: WebAssembly.Module) {
    this.x = new WebAssembly.Instance(module, {}).exports as unknown as Exports;
    this.x._initialize?.();
  }

  reset(seed: number, startUnix: number) {
    this.x.vn_sim_reset(seed, startUnix);
  }
  add(role: Role, x: number, y: number, wind: boolean, pms: boolean) {
    return this.x.vn_sim_add(ROLE[role], x, y, wind ? 1 : 0, pms ? 1 : 0);
  }
  set(key: number, v: number) {
    this.x.vn_sim_set(key, v);
  }
  get(key: number) {
    return this.x.vn_sim_get(key);
  }
  kill(i: number, dead: boolean) {
    this.x.vn_sim_kill(i, dead ? 1 : 0);
  }
  setSoc(i: number, soc: number) {
    this.x.vn_sim_set_soc(i, soc);
  }
  runUntil(ms: number) {
    this.x.vn_sim_run_until(ms);
  }
  now() {
    return this.x.vn_sim_now();
  }
  count() {
    return this.x.vn_sim_count();
  }
  state(i: number): Float64Array {
    return new Float64Array(
      this.x.memory.buffer,
      this.x.vn_sim_state(i),
      72,
    ).slice();
  }
  truePpmAt(x: number, y: number) {
    return this.x.vn_sim_true_ppm_at(x, y);
  }
  linkRssi(i: number, j: number) {
    return this.x.vn_sim_link_rssi(i, j);
  }
  private text(len: number): string | null {
    if (len < 0) return null;
    return decoder.decode(
      new Uint8Array(this.x.memory.buffer, this.x.vn_sim_buf(), len),
    );
  }
  payload(i: number) {
    return this.text(this.x.vn_sim_payload(i)) ?? "";
  }
  trace(i: number, max = 14): string[] {
    const out: string[] = [];
    for (let k = 0; k < max; k++) {
      const s = this.text(this.x.vn_sim_trace(i, k));
      if (s === null) break;
      out.push(s);
    }
    return out;
  }
  lineCount() {
    return this.x.vn_sim_lines();
  }
  line(k: number) {
    return this.text(this.x.vn_sim_line(k));
  }
  gatewayIn(s: string) {
    const bytes = new TextEncoder().encode(s);
    new Uint8Array(this.x.memory.buffer, this.x.vn_sim_buf(), bytes.length).set(
      bytes,
    );
    return this.x.vn_sim_gateway_in(bytes.length);
  }
  txCount() {
    return this.x.vn_sim_tx_count();
  }
  tx(k: number): Packet {
    const r = new Float64Array(this.x.memory.buffer, this.x.vn_sim_tx(k), 12);
    const heard: number[] = [];
    for (let j = 0; j < 40; j++) {
      const word = j < 32 ? r[9] : r[10];
      const bit = j < 32 ? j : j - 32;
      if (Math.floor(word / 2 ** bit) % 2) heard.push(j);
    }
    return {
      t0: r[0],
      t1: r[1],
      src: r[2],
      type: r[3],
      relay: r[4] === 1,
      len: r[5],
      heard,
      delivered: r[11] === 1,
    };
  }
}

/** Metres east/north of a point -> longitude/latitude (equirectangular, fine across a site). */
export function toLngLat(
  center: [number, number],
  x: number,
  y: number,
): [number, number] {
  const [lat, lon] = center;
  return [
    lon + x / (111_320 * Math.cos((lat * Math.PI) / 180)),
    lat + y / 110_574,
  ];
}
