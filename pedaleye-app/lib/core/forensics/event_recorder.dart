/// 단말 단독 사고 기록기와 가상 주행 스트림. 웹 event-buffer-freezer.ts, adaptive-sampler.ts,
/// mock-hardware-stream.ts 와 같은 규칙이다(실물 단말이 생기면 단말 펌웨어가 같은 일을 한다).
///   IDLE/ACTIVE(평시) → TRIGGERED(사고 후 30초 수집) → FROZEN(60초 세션 확정)
library;

import 'dart:typed_data';

import '../sensor/mock_pedal_sensor_source.dart';
import '../telemetry/displacement_engine.dart';
import '../telemetry/pedal_calculator.dart';
import 'hash_chain.dart';
import 'packet_codec.dart';

// ── 적응형 샘플링 ─────────────────────────────────────────────────────────
const idleIntervalMs = 1000; // 1Hz
const activeIntervalMs = 50; // 20Hz
const activeThresholdPercent = 2;

enum SamplingMode { idle, active }

class AdaptiveSampler {
  num _lastAt = double.negativeInfinity;
  num _lastAccel = 0;
  num _lastBrake = 0;
  SamplingMode mode = SamplingMode.idle;

  bool shouldRecord(int nowMs, num accelPercent, num brakePercent, {bool forceActive = false}) {
    final changed =
        (accelPercent - _lastAccel).abs() >= activeThresholdPercent ||
        (brakePercent - _lastBrake).abs() >= activeThresholdPercent;
    final pressed = accelPercent >= activeThresholdPercent || brakePercent >= activeThresholdPercent;
    mode = forceActive || changed || pressed ? SamplingMode.active : SamplingMode.idle;
    final interval = mode == SamplingMode.active ? activeIntervalMs : idleIntervalMs;
    if (nowMs - _lastAt < interval) return false;
    _lastAt = nowMs;
    _lastAccel = accelPercent;
    _lastBrake = brakePercent;
    return true;
  }
}

// ── 사고 트리거 ───────────────────────────────────────────────────────────
/// DB event_trigger_type 과 같은 값
enum TriggerType {
  shock('shock'),
  suddenAccel('sudden_accel'),
  manual('manual'),
  periodic('periodic');

  const TriggerType(this.dbValue);
  final String dbValue;

  static TriggerType? fromDb(Object? value) => values.where((t) => t.dbValue == value).firstOrNull;

  String get label => switch (this) {
    TriggerType.shock => '충격 감지',
    TriggerType.suddenAccel => '급가감속 감지',
    TriggerType.manual => '수동 긴급 백업',
    TriggerType.periodic => '정기 기록',
  };
}

class SensorSample {
  const SensorSample({
    required this.timestampMs,
    required this.accelDistance,
    required this.accelPercent,
    required this.brakeDistance,
    required this.brakePercent,
    this.latitudeE7 = 0,
    this.longitudeE7 = 0,
    this.speedDeciKmh = 0,
    this.impactG,
    this.longitudinalMs2,
  });

  final int timestampMs;
  final int accelDistance;
  final num accelPercent;
  final int brakeDistance;
  final num brakePercent;
  final int latitudeE7;
  final int longitudeE7;
  final int speedDeciKmh;

  /// 3축 가속도 합성 충격(G)
  final double? impactG;

  /// 진행 방향 가속도(감속은 음수, m/s²)
  final double? longitudinalMs2;
}

const shockThresholdG = 3.0;
const decelerationThresholdMs2 = -8.0;
const suddenBrakePercent = 80;
const suddenBrakeWindowMs = 200;
const _suddenBrakeFromPercent = 20;

/// 충격 3.0G 초과 → shock, 감속 8m/s² 이상 또는 0.2초 안에 제동 80% 도달 → sudden_accel(급가감속)
TriggerType? detectTrigger(List<SensorSample> recent, SensorSample current) {
  if ((current.impactG ?? 0) > shockThresholdG) return TriggerType.shock;
  if ((current.longitudinalMs2 ?? 0) <= decelerationThresholdMs2) return TriggerType.suddenAccel;
  if (current.brakePercent >= suddenBrakePercent) {
    final quickRise = recent.any(
      (s) => current.timestampMs - s.timestampMs <= suddenBrakeWindowMs && s.brakePercent <= _suddenBrakeFromPercent,
    );
    if (quickRise) return TriggerType.suddenAccel;
  }
  return null;
}

// ── 기록기 ────────────────────────────────────────────────────────────────
const defaultTriggerSamplingRateHz = 20; // 50Hz 로 올리면 60초 3,000개
const eventWindowSeconds = 30;

enum RecorderState { idle, active, triggered, frozen }

/// 단말이 만든 기록의 봉인 정보(docs/ble-protocol.md 5.6). 앱이 만든 기록에는 없다.
class DeviceSeal {
  const DeviceSeal({required this.serial, required this.sessionIndex, required this.signatureBase64, required this.finalHashHex});

  /// 기록을 만든 단말 일련번호(해시 체인 시작값의 기준)
  final String serial;

  /// 단말 안의 세션 번호(u32)
  final int sessionIndex;

  /// Ed25519 봉인 서명(64바이트) Base64
  final String signatureBase64;

  /// 단말 목록에 실린 최종 해시(전송 받은 파일과 같아야 함)
  final String finalHashHex;

  Map<String, Object?> toJson() => {'serial': serial, 'sessionIndex': sessionIndex, 'signature': signatureBase64, 'finalHash': finalHashHex};

  static DeviceSeal? fromJson(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final serial = json['serial'];
    final index = json['sessionIndex'];
    final signature = json['signature'];
    final finalHash = json['finalHash'];
    if (serial is! String || index is! int || signature is! String || finalHash is! String) return null;
    return DeviceSeal(serial: serial, sessionIndex: index, signatureBase64: signature, finalHashHex: finalHash);
  }
}

class FrozenSession {
  const FrozenSession({
    required this.triggerType,
    required this.triggerAtMs,
    required this.startTimeMs,
    required this.endTimeMs,
    required this.recordCount,
    required this.bytes,
    this.seal,
  });

  /// 단말이 봉인한 기록(BLE 전송)이면 봉인 정보
  final DeviceSeal? seal;

  final TriggerType triggerType;
  final int triggerAtMs;
  final int startTimeMs;
  final int endTimeMs;
  final int recordCount;

  /// .pel (패킷 + Final_Chain_Hash)
  final Uint8List bytes;
}

/// JavaScript Math.round 와 같은 반올림
int _jsRound(num v) => (v + 0.5).floor();

PacketPayload _toPayload(SensorSample s) => PacketPayload(
  sequenceId: 0, // 세션 확정 시 0부터 다시 매김
  timestampMs: s.timestampMs,
  accelDistance: s.accelDistance,
  accelPercent: _jsRound(s.accelPercent),
  brakeDistance: s.brakeDistance,
  brakePercent: _jsRound(s.brakePercent),
  bothPedal: determineOperationMode(s.accelPercent, s.brakePercent).isDualPressed,
  latitudeE7: s.latitudeE7,
  longitudeE7: s.longitudeE7,
  speedDeciKmh: s.speedDeciKmh,
);

class EventRecorder {
  EventRecorder(this.deviceId, {int rateHz = defaultTriggerSamplingRateHz})
    : windowPackets = rateHz * eventWindowSeconds;

  final String deviceId;
  final int windowPackets;
  final _sampler = AdaptiveSampler();
  final _preTrigger = <SensorSample>[];
  final _postTrigger = <SensorSample>[];
  ({TriggerType type, int atMs})? _trigger;
  bool _pendingManual = false;

  /// 평시 플래시 로그에 기록된 패킷 수(1Hz/20Hz 적응형)
  int routineRecorded = 0;
  RecorderState state = RecorderState.idle;

  /// 수동 긴급 백업 버튼: 다음 측정값부터 사고 후 구간으로 수집한다.
  void pressManualButton() {
    if (state == RecorderState.idle || state == RecorderState.active) _pendingManual = true;
  }

  void ingest(SensorSample sample) {
    if (state == RecorderState.frozen) return;

    if (state == RecorderState.triggered) {
      _postTrigger.add(sample);
      if (_postTrigger.length >= windowPackets) state = RecorderState.frozen;
      return;
    }

    final detected = _pendingManual ? TriggerType.manual : detectTrigger(_preTrigger, sample);
    if (detected != null) {
      _pendingManual = false;
      _trigger = (type: detected, atMs: sample.timestampMs);
      state = RecorderState.triggered;
      _postTrigger.add(sample);
      return;
    }

    if (_sampler.shouldRecord(sample.timestampMs, sample.accelPercent, sample.brakePercent)) routineRecorded++;
    state = _sampler.mode == SamplingMode.active ? RecorderState.active : RecorderState.idle;
    _preTrigger.add(sample);
    if (_preTrigger.length > windowPackets) _preTrigger.removeAt(0);
  }

  /// FROZEN 상태에서 직전 30초 + 이후 30초를 해시 체인 세션으로 확정한다.
  FrozenSession freeze() {
    final trigger = _trigger;
    if (state != RecorderState.frozen || trigger == null) throw StateError('아직 사고 후 30초 수집이 끝나지 않았습니다.');
    final samples = [..._preTrigger, ..._postTrigger];
    return FrozenSession(
      triggerType: trigger.type,
      triggerAtMs: trigger.atMs,
      startTimeMs: samples.first.timestampMs,
      endTimeMs: samples.last.timestampMs,
      recordCount: samples.length,
      bytes: buildChainedSession(deviceId, samples.map(_toPayload).toList()),
    );
  }
}

// ── 가상 주행 스트림 ──────────────────────────────────────────────────────
class DriveSegment {
  const DriveSegment({
    required this.durationMs,
    required this.accel,
    required this.brake,
    required this.speedKmh,
    this.impactG,
  });

  final int durationMs;

  /// 밟은 정도 0~1
  final double accel;
  final double brake;
  final double speedKmh;
  final double? impactG;
}

// 서울시청 인근(37.5665, 126.9780)에서 북쪽으로 이동
const _startLatE7 = 375665000;
const _startLonE7 = 1269780000;

/// 실제 단말 없이 주행을 흉내 내는 가상 센서 스트림(가상 시계, 즉시 생성)
Iterable<SensorSample> mockPedalHardwareStream(List<DriveSegment> segments, int startMs, {int rateHz = 20}) sync* {
  const a = (idle: MockPedalGeometry.accelIdle, full: MockPedalGeometry.accelFull);
  const b = (idle: MockPedalGeometry.brakeIdle, full: MockPedalGeometry.brakeFull);
  final step = 1000 / rateHz;
  num t = startMs;
  var latitude = _startLatE7;
  for (final segment in segments) {
    final end = t + segment.durationMs;
    for (; t < end; t += step) {
      final accelDistance = _jsRound(a.idle - segment.accel * (a.idle - a.full));
      final brakeDistance = _jsRound(b.idle - segment.brake * (b.idle - b.full));
      latitude += _jsRound(segment.speedKmh / 3.6 * (step / 1000) * 90); // 약 1m ≈ 90 (1e-7°)
      yield SensorSample(
        timestampMs: _jsRound(t),
        accelDistance: accelDistance,
        accelPercent: calculatePedalPercentage(accelDistance, a.full, a.idle),
        brakeDistance: brakeDistance,
        brakePercent: calculatePedalPercentage(brakeDistance, b.full, b.idle),
        latitudeE7: latitude,
        longitudeE7: _startLonE7,
        speedDeciKmh: _jsRound(segment.speedKmh * 10),
        impactG: segment.impactG,
      );
    }
  }
}
