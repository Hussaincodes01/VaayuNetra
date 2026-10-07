// Unit tests for src/lib/ots.ts: varuints, proof round trips, upgrades and .ots files.
// Checked against the live calendars and the OpenTimestamps example proof during development; the
// fixtures here are synthetic so the tests need no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bitcoinAttestations,
  mergeStamp,
  otsFile,
  parseOtsFile,
  parseStamp,
  pendingAttestations,
  serializeStamp,
  sha256,
  toHex,
  varuint,
} from "../../src/lib/ots.ts";

const APPEND = 0xf0;
const PREPEND = 0xf1;
const SHA256 = 0x08;
const leaf = (msg, attestation) => ({
  msg,
  attestations: [attestation],
  ops: [],
});
const step = (msg, op, next) => ({
  msg,
  attestations: [],
  ops: [{ op, stamp: next }],
});

/** digest -> append(nonce) -> sha256 -> pending attestation, as a calendar returns it. */
function calendarStamp(digest) {
  const nonce = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
  const appended = Uint8Array.from([...digest, ...nonce]);
  const hashed = sha256(appended);
  return step(
    digest,
    { tag: APPEND, arg: nonce },
    step(
      appended,
      { tag: SHA256 },
      leaf(hashed, {
        kind: "pending",
        uri: "https://alice.btc.calendar.opentimestamps.org",
      }),
    ),
  );
}

test("varuints are LEB128", () => {
  assert.equal(toHex(varuint(0)), "00");
  assert.equal(toHex(varuint(127)), "7f");
  assert.equal(toHex(varuint(128)), "8001");
  assert.equal(toHex(varuint(358391)), "f7ef15");
});

test("a calendar proof survives serialise -> parse -> serialise", () => {
  const digest = sha256("vayunetra-ledger:1:" + "0".repeat(64));
  const bytes = serializeStamp(calendarStamp(digest));
  const parsed = parseStamp(bytes, digest);
  assert.deepEqual(serializeStamp(parsed), bytes);
  const pending = pendingAttestations(parsed);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].uri, "https://alice.btc.calendar.opentimestamps.org");
  assert.equal(bitcoinAttestations(parsed).length, 0);
});

test("an upgrade merges in a Bitcoin attestation and the .ots file keeps it", () => {
  const digest = sha256("vayunetra-ledger:2:" + "a".repeat(64));
  const stamp = calendarStamp(digest);
  const node = pendingAttestations(stamp)[0].node;
  const prefix = Uint8Array.from([9, 9, 9]);
  const joined = Uint8Array.from([...prefix, ...node.msg]);
  const root = sha256(joined);
  const upgrade = step(
    node.msg,
    { tag: PREPEND, arg: prefix },
    step(
      joined,
      { tag: SHA256 },
      leaf(root, { kind: "bitcoin", height: 358391 }),
    ),
  );
  mergeStamp(node, parseStamp(serializeStamp(upgrade), node.msg));
  const btc = bitcoinAttestations(stamp);
  assert.equal(btc.length, 1);
  assert.equal(btc[0].height, 358391);
  assert.equal(toHex(btc[0].msg), toHex(root));

  const file = otsFile(digest, stamp);
  const back = parseOtsFile(file);
  assert.equal(toHex(back.digest), toHex(digest));
  assert.deepEqual(serializeStamp(back.stamp), serializeStamp(stamp));
  assert.equal(bitcoinAttestations(back.stamp)[0].height, 358391);
});

test("bad input is refused", () => {
  assert.throws(
    () => parseOtsFile(Uint8Array.from([1, 2, 3])),
    /not an OpenTimestamps proof/,
  );
  const digest = sha256("x");
  const bytes = serializeStamp(calendarStamp(digest));
  assert.throws(
    () => parseStamp(bytes.slice(0, bytes.length - 3), digest),
    /unexpected end/,
  );
  assert.throws(
    () => parseStamp(Uint8Array.from([...bytes, 0]), digest),
    /trailing bytes/,
  );
});
