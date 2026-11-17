// BLE 규격(docs/ble-protocol.md) 시험 벡터 생성기. 결정적(같은 입력 → 같은 출력)이라 다시 돌려도 결과가 같다.
// 실행: node tool/generate_ble_vectors.mjs > test/fixtures/ble_test_vectors.json
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";

const hex = (b) => Buffer.from(b).toString("hex");
const sha256 = (b) => createHash("sha256").update(b).digest();

// ── 시험용 단말 키(실제 단말에 절대 쓰지 말 것) ──
const seed = sha256(Buffer.from("PEDALEYE-TEST-DEVICE-KEY-1"));
const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
const publicKey = createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(-32);
const ed25519 = (msg) => sign(null, msg, privateKey);

const fixed = (text, size) => {
  const out = Buffer.alloc(size);
  const raw = Buffer.from(text, "utf8");
  if (raw.length > size) throw new Error(`${text} 는 ${size}바이트를 넘습니다`);
  raw.copy(out);
  return out;
};

const SERIAL = "PE-2026-000001";

// ── CRC ──
function crc8(bytes) { // CRC-8 (poly 0x07, init 0x00, 반사 없음, xorout 0x00)
  let crc = 0;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}
const CRC32_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) { // IEEE 802.3
  let c = 0xffffffff;
  for (const b of bytes) c = CRC32_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── 64바이트 패킷 ──
function packet(f, seq, prevHash) {
  const p = Buffer.alloc(64);
  p.writeUInt32LE(seq, 0);
  p.writeBigUInt64LE(BigInt(f.timestampMs), 4);
  p.writeUInt16LE(f.accelDistance, 12);
  p.writeUInt8(f.accelPercent, 14);
  p.writeUInt16LE(f.brakeDistance, 15);
  p.writeUInt8(f.brakePercent, 17);
  p.writeUInt8(f.bothPedal ? 1 : 0, 18);
  p.writeInt32LE(f.latitudeE7, 20);
  p.writeInt32LE(f.longitudeE7, 24);
  p.writeUInt16LE(f.speedDeciKmh, 28);
  prevHash.copy(p, 32);
  return p;
}
const genesis = (serial, startMs) => sha256(Buffer.from(`PEDAL_EYE_GENESIS_${serial}_${startMs}`, "utf8"));
function chain(serial, frames) {
  let prev = genesis(serial, frames[0].timestampMs);
  const genesisHash = prev;
  const packets = frames.map((f, i) => {
    const p = packet(f, i, prev);
    prev = sha256(p);
    return { fields: { sequenceId: i, ...f }, hex: hex(p), hash: hex(prev) };
  });
  return { genesisHash: hex(genesisHash), packets, finalHash: hex(prev) };
}

const T0 = 1794900000000; // 2026-11-17 경
const base = { latitudeE7: 375665000, longitudeE7: 1269780000 };
const realtimeFrames = [
  { name: "가속 100%", timestampMs: T0, accelDistance: 8050, accelPercent: 100, brakeDistance: 13000, brakePercent: 0, bothPedal: false, speedDeciKmh: 520, ...base },
  { name: "제동 100%", timestampMs: T0 + 50, accelDistance: 12050, accelPercent: 0, brakeDistance: 9500, brakePercent: 100, bothPedal: false, speedDeciKmh: 515, ...base },
  { name: "양발 동시", timestampMs: T0 + 100, accelDistance: 10050, accelPercent: 50, brakeDistance: 11250, brakePercent: 50, bothPedal: true, speedDeciKmh: 510, ...base },
];
const realtime = chain(SERIAL, realtimeFrames.map(({ name: _n, ...f }) => f));
realtime.packets.forEach((p, i) => (p.name = realtimeFrames[i].name));

// ── 단말 인증 ──
const DOMAIN_ATTEST = fixed("PEDAL_EYE_DEVICE_ATTESTATION_V1", 32);
const nonce = sha256(Buffer.from("PEDALEYE-TEST-NONCE-1"));
const attestMessage = Buffer.concat([DOMAIN_ATTEST, fixed(SERIAL, 16), nonce]);
const attestSignature = ed25519(attestMessage);
const tampered = Buffer.from(attestSignature);
tampered[0] ^= 0x01;

// ── 보정·시각 ──
const calib = Buffer.alloc(8);
[11200, 12900, 9800, 13050].forEach((v, i) => calib.writeUInt16LE(v, i * 2));
const timeSync = Buffer.alloc(8);
timeSync.writeBigUInt64LE(BigInt(T0 + 1000));
const status = Buffer.from([87, 0b00000011, 2, 0]); // 배터리 87%, 센서 정상·시각 동기화됨, 보관 세션 2건(u16 LE)

// ── 사고 기록 세션(.pel) ──
const sessionFrames = Array.from({ length: 6 }, (_, i) => ({
  timestampMs: T0 + 60000 + i * 20,
  accelDistance: i < 3 ? 12050 - i * 1000 : 12050,
  accelPercent: i < 3 ? i * 25 : 0,
  brakeDistance: i >= 3 ? 13000 - (i - 2) * 1000 : 13000,
  brakePercent: i >= 3 ? (i - 2) * 30 : 0,
  bothPedal: false,
  speedDeciKmh: 600 - i * 10,
  ...base,
}));
const session = chain(SERIAL, sessionFrames);
const pel = Buffer.concat([...session.packets.map((p) => Buffer.from(p.hex, "hex")), Buffer.from(session.finalHash, "hex")]);
const SESSION_ID = 7;
const MAX_PAYLOAD = 236;
function chunks(data, offset) {
  const out = [];
  for (let pos = offset, seq = 0; pos < data.length; pos += MAX_PAYLOAD, seq++) {
    const payload = data.subarray(pos, Math.min(pos + MAX_PAYLOAD, data.length));
    const header = Buffer.alloc(4);
    header.writeUInt16LE(seq, 0);
    header.writeUInt8(payload.length, 2);
    header.writeUInt8(crc8(payload), 3);
    out.push({ chunkSeq: seq, offset: pos, payloadSize: payload.length, crc8: crc8(payload), hex: hex(Buffer.concat([header, payload])) });
  }
  return out;
}
const control = (cmd, sessionId, offset) => {
  const b = Buffer.alloc(12);
  b.writeUInt8(cmd, 0);
  b.writeUInt32LE(sessionId, 1);
  b.writeUInt32LE(offset, 5);
  return hex(b);
};

// 세션 봉인 서명(단말이 세션을 닫을 때 서명, 목록에 실림)
const DOMAIN_SEAL = fixed("PEDAL_EYE_SESSION_SEAL_V1", 32);
const sealFields = Buffer.alloc(16);
sealFields.writeUInt32LE(SESSION_ID, 0);
sealFields.writeBigUInt64LE(BigInt(sessionFrames[0].timestampMs), 4);
sealFields.writeUInt32LE(sessionFrames.length, 12);
const sealMessage = Buffer.concat([DOMAIN_SEAL, fixed(SERIAL, 16), sealFields, Buffer.from(session.finalHash, "hex")]);
const sealSignature = ed25519(sealMessage);
const entry = Buffer.alloc(120);
entry.writeUInt32LE(SESSION_ID, 0);
entry.writeUInt8(0, 4); // trigger: 0 = shock
entry.writeUInt8(0, 5); // flags
entry.writeBigUInt64LE(BigInt(sessionFrames[0].timestampMs), 8);
entry.writeUInt32LE(sessionFrames.length, 16);
entry.writeUInt32LE(pel.length, 20);
Buffer.from(session.finalHash, "hex").copy(entry, 24);
sealSignature.copy(entry, 56);

const transferComplete = Buffer.alloc(18);
transferComplete.writeUInt8(4, 0); // complete
transferComplete.writeUInt8(0, 1);
transferComplete.writeUInt32LE(SESSION_ID, 2);
transferComplete.writeUInt32LE(pel.length, 6);
transferComplete.writeUInt32LE(pel.length, 10);
transferComplete.writeUInt32LE(crc32(pel), 14);
const ack = (type, seq) => {
  const b = Buffer.alloc(3);
  b.writeUInt8(type, 0);
  b.writeUInt16LE(seq, 1);
  return hex(b);
};

const vectors = {
  protocolVersion: "1.0",
  note: "시험 전용 키·데이터. 실제 단말·운영에 쓰지 말 것. 생성: node tool/generate_ble_vectors.mjs",
  serial: SERIAL,
  crc: { input: hex(Buffer.from("123456789")), crc8: crc8(Buffer.from("123456789")), crc32: crc32(Buffer.from("123456789")) },
  attestation: {
    seed: hex(seed),
    publicKey: hex(publicKey),
    domainTag: hex(DOMAIN_ATTEST),
    nonce: hex(nonce),
    message: hex(attestMessage),
    signature: hex(attestSignature),
    tamperedSignature: hex(tampered),
  },
  realtime: { serial: SERIAL, ...realtime },
  calibration: { accelMin: 11200, accelMax: 12900, brakeMin: 9800, brakeMax: 13050, hex: hex(calib) },
  timeSync: { epochMs: T0 + 1000, hex: hex(timeSync) },
  deviceStatus: { batteryPercent: 87, sensorOk: true, rtcSynced: true, storageFull: false, storedSessions: 2, hex: hex(status) },
  session: {
    sessionId: SESSION_ID,
    startMs: sessionFrames[0].timestampMs,
    recordCount: sessionFrames.length,
    genesisHash: session.genesisHash,
    finalHash: session.finalHash,
    pel: hex(pel),
    crc32: crc32(pel),
    chunksFromStart: chunks(pel, 0),
    resumeOffset: 236,
    chunksFromResume: chunks(pel, 236),
    indexEntry: { trigger: "shock", sealMessage: hex(sealMessage), sealSignature: hex(sealSignature), hex: hex(entry) },
    transferComplete: hex(transferComplete),
  },
  control: {
    start: control(0x01, SESSION_ID, 0),
    resume: control(0x01, SESSION_ID, 236),
    pause: control(0x02, SESSION_ID, 0),
    cancel: control(0x03, SESSION_ID, 0),
    list: control(0x04, 0, 0),
    confirmArchived: control(0x05, SESSION_ID, 0),
    ack: ack(0x10, 1),
    nack: ack(0x11, 1),
  },
};
process.stdout.write(`${JSON.stringify(vectors, null, 2)}\n`);
