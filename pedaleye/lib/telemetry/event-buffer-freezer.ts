/**
 * 단말 단독 사고 기록기. 스마트폰 연결 없이 동작하도록 외부 의존 없는 상태 머신으로 둔다.
 *   IDLE/ACTIVE(평시, 적응형 샘플링) → TRIGGERED(사고 후 30초 수집) → FROZEN(60초 세션 확정)
 * 평시에도 직전 30초(20Hz 600개)를 순환 버퍼에 유지하고, 트리거 시 이후 30초를 더해 해시 체인으로 묶는다.
 */
import { AdaptiveSampler } from "@/lib/telemetry/adaptive-sampler";
import { buildChainedSession } from "@/lib/telemetry/hash-chain-engine";
import type { PacketPayload } from "@/lib/telemetry/packet-codec";
import { determineOperationMode } from "@/lib/telemetry/pedal-calculator";

export const DEFAULT_TRIGGER_SAMPLING_RATE_HZ = 20; // 50Hz 로 올리면 60초 3,000개
export const EVENT_WINDOW_SECONDS = 30;

export type TriggerType = "shock" | "sudden_accel" | "manual" | "periodic";
export type RecorderState = "IDLE" | "ACTIVE" | "TRIGGERED" | "FROZEN";

export interface SensorSample {
  timestampMs: number;
  accelDistance: number;
  accelPercent: number;
  brakeDistance: number;
  brakePercent: number;
  latitudeE7: number;
  longitudeE7: number;
  speedDeciKmh: number;
  impactG?: number; // 3축 가속도 합성 충격(G)
  longitudinalMs2?: number; // 진행 방향 가속도(감속은 음수)
}

export const SHOCK_THRESHOLD_G = 3.0;
export const DECELERATION_THRESHOLD_MS2 = -8;
export const SUDDEN_BRAKE_PERCENT = 80;
export const SUDDEN_BRAKE_WINDOW_MS = 200;
const SUDDEN_BRAKE_FROM_PERCENT = 20;

/** 충격 3.0G 초과 → shock, 감속 8m/s² 이상 또는 0.2초 안에 제동 80% 도달 → sudden_accel(급가감속) */
export function detectTrigger(recent: readonly SensorSample[], current: SensorSample): TriggerType | null {
  if ((current.impactG ?? 0) > SHOCK_THRESHOLD_G) return "shock";
  if ((current.longitudinalMs2 ?? 0) <= DECELERATION_THRESHOLD_MS2) return "sudden_accel";
  if (current.brakePercent >= SUDDEN_BRAKE_PERCENT) {
    const quickRise = recent.some(
      (sample) =>
        current.timestampMs - sample.timestampMs <= SUDDEN_BRAKE_WINDOW_MS &&
        sample.brakePercent <= SUDDEN_BRAKE_FROM_PERCENT,
    );
    if (quickRise) return "sudden_accel";
  }
  return null;
}

export interface FrozenSession {
  triggerType: TriggerType;
  triggerAtMs: number;
  startTimeMs: number;
  endTimeMs: number;
  recordCount: number;
  bytes: Uint8Array; // .pel (패킷 + Final_Chain_Hash)
}

function toPayload(sample: SensorSample): PacketPayload {
  return {
    sequenceId: 0, // 세션 확정 시 0부터 다시 매김
    timestampMs: sample.timestampMs,
    accelDistance: sample.accelDistance,
    accelPercent: Math.round(sample.accelPercent),
    brakeDistance: sample.brakeDistance,
    brakePercent: Math.round(sample.brakePercent),
    bothPedal: determineOperationMode(sample.accelPercent, sample.brakePercent).isDualPressed,
    latitudeE7: sample.latitudeE7,
    longitudeE7: sample.longitudeE7,
    speedDeciKmh: sample.speedDeciKmh,
  };
}

export class EventRecorder {
  readonly windowPackets: number;
  private readonly sampler = new AdaptiveSampler();
  private readonly preTrigger: SensorSample[] = [];
  private readonly postTrigger: SensorSample[] = [];
  private trigger: { type: TriggerType; atMs: number } | null = null;
  private pendingManual = false;
  /** 평시 플래시 로그에 기록된 패킷 수(1Hz/20Hz 적응형) */
  routineRecorded = 0;
  state: RecorderState = "IDLE";

  constructor(
    private readonly deviceId: string,
    rateHz: number = DEFAULT_TRIGGER_SAMPLING_RATE_HZ,
  ) {
    this.windowPackets = rateHz * EVENT_WINDOW_SECONDS;
  }

  /** 수동 긴급 백업 버튼: 다음 측정값부터 사고 후 구간으로 수집한다. */
  pressManualButton(): void {
    if (this.state === "IDLE" || this.state === "ACTIVE") this.pendingManual = true;
  }

  /** 센서 측정값 입력(트리거 샘플링 주기마다 호출). */
  ingest(sample: SensorSample): void {
    if (this.state === "FROZEN") return;

    if (this.state === "TRIGGERED") {
      this.postTrigger.push(sample);
      if (this.postTrigger.length >= this.windowPackets) this.state = "FROZEN";
      return;
    }

    const detected = this.pendingManual ? "manual" : detectTrigger(this.preTrigger, sample);
    if (detected) {
      this.pendingManual = false;
      this.trigger = { type: detected, atMs: sample.timestampMs };
      this.state = "TRIGGERED";
      this.postTrigger.push(sample);
      return;
    }

    if (this.sampler.shouldRecord(sample.timestampMs, sample.accelPercent, sample.brakePercent)) {
      this.routineRecorded += 1;
    }
    this.state = this.sampler.mode;
    this.preTrigger.push(sample);
    if (this.preTrigger.length > this.windowPackets) this.preTrigger.shift();
  }

  /** FROZEN 상태에서 직전 30초 + 이후 30초를 해시 체인 세션으로 확정한다. */
  async freeze(): Promise<FrozenSession> {
    if (this.state !== "FROZEN" || !this.trigger) throw new Error("아직 사고 후 30초 수집이 끝나지 않았습니다.");
    const samples = [...this.preTrigger, ...this.postTrigger];
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (!first || !last) throw new Error("기록된 샘플이 없습니다.");

    return {
      triggerType: this.trigger.type,
      triggerAtMs: this.trigger.atMs,
      startTimeMs: first.timestampMs,
      endTimeMs: last.timestampMs,
      recordCount: samples.length,
      bytes: await buildChainedSession(this.deviceId, samples.map(toPayload)),
    };
  }
}
