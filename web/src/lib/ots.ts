// OpenTimestamps: stamp a SHA-256 digest on the public calendars, upgrade the pending proof once the
// calendar has committed it to a Bitcoin block, and write a standard .ots file anyone can verify
// (https://opentimestamps.org, or `ots verify`). Format as in python-opentimestamps:
//   timestamp := (0xff item)* item;  item := 0x00 attestation | op timestamp
//   attestation := tag(8 bytes) varbytes(payload);  op := tag [varbytes arg]
// Only node:crypto is imported, so the unit tests load this file directly.

import { createHash } from "node:crypto";

export const PENDING_TAG = "83dfe30d2ef90c8e";
export const BITCOIN_TAG = "0588960d73d71901";
const MAGIC = Uint8Array.from([
  0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d,
  0x70, 0x73, 0x00, 0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2,
  0xe8, 0x84, 0xe8, 0x92, 0x94,
]);

export const CALENDARS = [
  "https://a.pool.opentimestamps.org",
  "https://b.pool.opentimestamps.org",
];

export type Attestation =
  | { kind: "pending"; uri: string }
  | { kind: "bitcoin"; height: number }
  | { kind: "unknown"; tag: string; payload: Uint8Array };

export type Op = { tag: number; arg?: Uint8Array };

export type Stamp = {
  msg: Uint8Array;
  attestations: Attestation[];
  ops: { op: Op; stamp: Stamp }[];
};

const UNARY: Record<number, string> = {
  0x02: "sha1",
  0x03: "ripemd160",
  0x08: "sha256",
};
const APPEND = 0xf0;
const PREPEND = 0xf1;

export const toHex = (b: Uint8Array) => Buffer.from(b).toString("hex");
export const fromHex = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));
const concat = (...parts: Uint8Array[]) =>
  Uint8Array.from(Buffer.concat(parts));
const equal = (a: Uint8Array, b: Uint8Array) =>
  Buffer.from(a).equals(Buffer.from(b));

export const sha256 = (data: Uint8Array | string) =>
  Uint8Array.from(createHash("sha256").update(data).digest());

// --- bytes in / out ------------------------------------------------------------------------------

class Reader {
  private i = 0;
  private readonly b: Uint8Array;
  constructor(b: Uint8Array) {
    this.b = b;
  }
  byte(): number {
    if (this.i >= this.b.length)
      throw new Error("ots: unexpected end of proof");
    return this.b[this.i++];
  }
  bytes(n: number): Uint8Array {
    if (this.i + n > this.b.length)
      throw new Error("ots: unexpected end of proof");
    const out = this.b.slice(this.i, this.i + n);
    this.i += n;
    return out;
  }
  varuint(): number {
    let value = 0;
    let shift = 0;
    for (;;) {
      const b = this.byte();
      value += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) return value;
      shift += 7;
      if (shift > 49) throw new Error("ots: varuint too long");
    }
  }
  varbytes(max = 8192): Uint8Array {
    const n = this.varuint();
    if (n > max) throw new Error("ots: field too long");
    return this.bytes(n);
  }
  get done() {
    return this.i >= this.b.length;
  }
}

export function varuint(n: number): Uint8Array {
  const out: number[] = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return Uint8Array.from(out);
}

const varbytes = (b: Uint8Array) => concat(varuint(b.length), b);

// --- ops and attestations ------------------------------------------------------------------------

export function applyOp(op: Op, msg: Uint8Array): Uint8Array {
  if (op.tag === APPEND) return concat(msg, op.arg!);
  if (op.tag === PREPEND) return concat(op.arg!, msg);
  const algo = UNARY[op.tag];
  if (!algo) throw new Error(`ots: unsupported op 0x${op.tag.toString(16)}`);
  return Uint8Array.from(createHash(algo).update(msg).digest());
}

function readOp(r: Reader, tag: number): Op {
  if (tag === APPEND || tag === PREPEND) return { tag, arg: r.varbytes(4096) };
  if (UNARY[tag]) return { tag };
  throw new Error(`ots: unknown op 0x${tag.toString(16)}`);
}

const opBytes = (op: Op) =>
  op.arg
    ? concat(Uint8Array.of(op.tag), varbytes(op.arg))
    : Uint8Array.of(op.tag);

function readAttestation(r: Reader): Attestation {
  const tag = toHex(r.bytes(8));
  const payload = r.varbytes(8192);
  if (tag === PENDING_TAG) {
    const inner = new Reader(payload);
    return {
      kind: "pending",
      uri: Buffer.from(inner.varbytes(1000)).toString("utf8"),
    };
  }
  if (tag === BITCOIN_TAG)
    return { kind: "bitcoin", height: new Reader(payload).varuint() };
  return { kind: "unknown", tag, payload };
}

function attestationBytes(a: Attestation): Uint8Array {
  if (a.kind === "pending")
    return concat(
      fromHex(PENDING_TAG),
      varbytes(varbytes(Buffer.from(a.uri, "utf8"))),
    );
  if (a.kind === "bitcoin")
    return concat(fromHex(BITCOIN_TAG), varbytes(varuint(a.height)));
  return concat(fromHex(a.tag), varbytes(a.payload));
}

// --- timestamps ----------------------------------------------------------------------------------

function readStamp(r: Reader, msg: Uint8Array, depth = 0): Stamp {
  if (depth > 256) throw new Error("ots: proof too deep");
  const stamp: Stamp = { msg, attestations: [], ops: [] };
  const item = (tag: number) => {
    if (tag === 0x00) stamp.attestations.push(readAttestation(r));
    else {
      const op = readOp(r, tag);
      stamp.ops.push({ op, stamp: readStamp(r, applyOp(op, msg), depth + 1) });
    }
  };
  let tag = r.byte();
  while (tag === 0xff) {
    item(r.byte());
    tag = r.byte();
  }
  item(tag);
  return stamp;
}

/** Parse a calendar response (a timestamp for `msg`). */
export function parseStamp(bytes: Uint8Array, msg: Uint8Array): Stamp {
  const r = new Reader(bytes);
  const stamp = readStamp(r, msg);
  if (!r.done) throw new Error("ots: trailing bytes after the proof");
  return stamp;
}

const byBytes = (a: Uint8Array, b: Uint8Array) =>
  Buffer.compare(Buffer.from(a), Buffer.from(b));

export function serializeStamp(s: Stamp): Uint8Array {
  const atts = s.attestations.map(attestationBytes).sort(byBytes);
  const ops = s.ops
    .map(({ op, stamp }) => ({ key: opBytes(op), stamp }))
    .sort((a, b) => byBytes(a.key, b.key));
  const out: Uint8Array[] = [];
  if (!ops.length) {
    atts.slice(0, -1).forEach((a) => out.push(Uint8Array.of(0xff, 0x00), a));
    out.push(Uint8Array.of(0x00), atts[atts.length - 1]);
  } else {
    atts.forEach((a) => out.push(Uint8Array.of(0xff, 0x00), a));
    ops
      .slice(0, -1)
      .forEach(({ key, stamp }) =>
        out.push(Uint8Array.of(0xff), key, serializeStamp(stamp)),
      );
    const last = ops[ops.length - 1];
    out.push(last.key, serializeStamp(last.stamp));
  }
  return concat(...out);
}

/** Merge `other` (a timestamp for the same msg) into `into`. */
export function mergeStamp(into: Stamp, other: Stamp): void {
  if (!equal(into.msg, other.msg))
    throw new Error("ots: merging stamps for different messages");
  for (const a of other.attestations) {
    const key = toHex(attestationBytes(a));
    if (!into.attestations.some((b) => toHex(attestationBytes(b)) === key))
      into.attestations.push(a);
  }
  for (const o of other.ops) {
    const key = toHex(opBytes(o.op));
    const mine = into.ops.find((x) => toHex(opBytes(x.op)) === key);
    if (mine) mergeStamp(mine.stamp, o.stamp);
    else into.ops.push(o);
  }
}

/** Every node of the tree with its attestations (depth first). */
export function walk(s: Stamp, visit: (node: Stamp) => void): void {
  visit(s);
  s.ops.forEach((o) => walk(o.stamp, visit));
}

export function bitcoinAttestations(
  s: Stamp,
): { height: number; msg: Uint8Array }[] {
  const out: { height: number; msg: Uint8Array }[] = [];
  walk(s, (n) =>
    n.attestations.forEach(
      (a) => a.kind === "bitcoin" && out.push({ height: a.height, msg: n.msg }),
    ),
  );
  return out;
}

export function pendingAttestations(s: Stamp): { uri: string; node: Stamp }[] {
  const out: { uri: string; node: Stamp }[] = [];
  walk(s, (n) =>
    n.attestations.forEach(
      (a) => a.kind === "pending" && out.push({ uri: a.uri, node: n }),
    ),
  );
  return out;
}

/** Read a detached .ots file (SHA-256 only): the file digest and its timestamp. */
export function parseOtsFile(bytes: Uint8Array): {
  digest: Uint8Array;
  stamp: Stamp;
} {
  if (!equal(bytes.slice(0, MAGIC.length), MAGIC))
    throw new Error("ots: not an OpenTimestamps proof");
  const r = new Reader(bytes.slice(MAGIC.length));
  if (r.varuint() !== 1) throw new Error("ots: unsupported proof version");
  if (r.byte() !== 0x08)
    throw new Error("ots: only SHA-256 file digests are supported");
  const digest = r.bytes(32);
  const stamp = readStamp(r, digest);
  if (!r.done) throw new Error("ots: trailing bytes after the proof");
  return { digest, stamp };
}

/** A standard detached .ots file for a SHA-256 digest. */
export function otsFile(digest: Uint8Array, stamp: Stamp): Uint8Array {
  return concat(
    MAGIC,
    varuint(1),
    Uint8Array.of(0x08),
    digest,
    serializeStamp(stamp),
  );
}

// --- calendars -----------------------------------------------------------------------------------

const HEADERS = {
  Accept: "application/vnd.opentimestamps.v1",
  "User-Agent": "VayuNetra integrity ledger",
};

/** Submit a digest to a calendar; returns its (pending) timestamp. */
export async function submitDigest(
  calendar: string,
  digest: Uint8Array,
): Promise<Stamp> {
  const res = await fetch(`${calendar}/digest`, {
    method: "POST",
    headers: {
      ...HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: Buffer.from(digest),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`calendar ${calendar}: HTTP ${res.status}`);
  return parseStamp(new Uint8Array(await res.arrayBuffer()), digest);
}

/** Ask the calendar named in a pending attestation for the completed timestamp; null while pending. */
export async function fetchUpgrade(
  uri: string,
  msg: Uint8Array,
): Promise<Stamp | null> {
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(uri))
    throw new Error(`ots: refusing calendar ${uri}`);
  const res = await fetch(`${uri}/timestamp/${toHex(msg)}`, {
    headers: HEADERS,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`calendar ${uri}: HTTP ${res.status}`);
  return parseStamp(new Uint8Array(await res.arrayBuffer()), msg);
}

/** Esplora block explorers with the same API; tried in order. */
const EXPLORERS = ["https://mempool.space/api", "https://blockstream.info/api"];

/**
 * Check a Bitcoin attestation against the block itself: the attested message must be the block's
 * Merkle root (shown byte-reversed by block explorers). `ok` is false when the roots differ; it throws
 * only when no explorer could be reached.
 */
export async function checkBitcoinBlock(
  height: number,
  msg: Uint8Array,
): Promise<{ ok: boolean; time: string | null; explorer: string }> {
  const root = toHex(Uint8Array.from(msg).reverse());
  let last: unknown = null;
  for (const base of EXPLORERS) {
    try {
      const get = (path: string) =>
        fetch(`${base}${path}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        });
      const hash = (await (await get(`/block-height/${height}`)).text()).trim();
      if (!/^[0-9a-f]{64}$/.test(hash))
        throw new Error(`no block at height ${height}`);
      const block = (await (await get(`/block/${hash}`)).json()) as {
        merkle_root?: string;
        timestamp?: number;
      };
      return {
        ok: block.merkle_root === root,
        time: block.timestamp
          ? new Date(block.timestamp * 1000).toISOString()
          : null,
        explorer: base,
      };
    } catch (e) {
      last = e;
    }
  }
  throw new Error(
    `no block explorer reachable: ${(last as Error)?.message ?? "unknown"}`,
  );
}
