/// 4단계 캘리브레이션 마법사 진행 규칙(순수 상태 머신). 웹 lib/calibration/wizard.ts 와 같은 규칙이다.
library;

import '../telemetry/displacement_engine.dart';

enum Pedal { accel, brake }

/// 가속 0% → 가속 100% → 제동 0% → 제동 100%
enum CaptureKey { accelIdle, accelFull, brakeIdle, brakeFull }

class WizardStep {
  const WizardStep({required this.key, required this.pedal, required this.title, required this.instruction});

  final CaptureKey key;
  final Pedal pedal;
  final String title;
  final String instruction;

  bool get isFullPress => key == CaptureKey.accelFull || key == CaptureKey.brakeFull;
}

const captureSeconds = 3;

const wizardSteps = <WizardStep>[
  WizardStep(
    key: CaptureKey.accelIdle,
    pedal: Pedal.accel,
    title: '가속 페달 영점(0%)',
    instruction: '가속 페달에서 발을 완전히 떼고 3초간 기다려 주세요.',
  ),
  WizardStep(
    key: CaptureKey.accelFull,
    pedal: Pedal.accel,
    title: '가속 페달 최대(100%)',
    instruction: '가속 페달을 바닥까지 끝까지 힘껏 밟은 상태를 3초간 유지해 주세요.',
  ),
  WizardStep(
    key: CaptureKey.brakeIdle,
    pedal: Pedal.brake,
    title: '제동 페달 영점(0%)',
    instruction: '브레이크 페달에서 발을 완전히 떼고 3초간 기다려 주세요.',
  ),
  WizardStep(
    key: CaptureKey.brakeFull,
    pedal: Pedal.brake,
    title: '제동 페달 최대(100%)',
    instruction: '브레이크 페달을 온 힘을 다해 끝까지 밟은 상태를 3초간 유지해 주세요.',
  ),
];

const unstableMessage = '측정값이 흔들렸습니다. 페달을 같은 자세로 유지한 채 다시 측정해 주세요.';

String shallowStrokeMessage(Pedal pedal) =>
    '${pedal == Pedal.accel ? '가속' : '제동'} 페달 가동 범위가 너무 작습니다(최소 5mm 이상 필요). 끝까지 밟은 뒤 다시 측정해 주세요.';

class WizardState {
  const WizardState({required this.stepIndex, required this.captured, this.error});

  static const initial = WizardState(stepIndex: 0, captured: {});

  /// 0~3: 측정 단계, 4: 반응 테스트·저장 단계
  final int stepIndex;
  final Map<CaptureKey, int> captured;
  final String? error;

  WizardStep? get step => stepIndex < wizardSteps.length ? wizardSteps[stepIndex] : null;
  bool get isComplete => stepIndex >= wizardSteps.length;
}

/// 3초 수집 결과를 반영한다. 흔들렸거나 가동 범위가 모자라면 같은 단계에 머물며 오류를 남긴다.
WizardState applyCapture(WizardState state, SampleSummary summary) {
  final step = state.step;
  if (step == null) return state;

  if (!summary.stable) return WizardState(stepIndex: state.stepIndex, captured: state.captured, error: unstableMessage);

  if (step.isFullPress) {
    final idle = state.captured[step.pedal == Pedal.accel ? CaptureKey.accelIdle : CaptureKey.brakeIdle] ?? 0;
    if (idle - summary.average < minStroke) {
      return WizardState(stepIndex: state.stepIndex, captured: state.captured, error: shallowStrokeMessage(step.pedal));
    }
  }

  return WizardState(stepIndex: state.stepIndex + 1, captured: {...state.captured, step.key: summary.average});
}

class CalibrationPayload {
  const CalibrationPayload({
    required this.deviceId,
    required this.accelCalibMin,
    required this.accelCalibMax,
    required this.brakeCalibMin,
    required this.brakeCalibMax,
  });

  final String deviceId;
  final int accelCalibMin;
  final int accelCalibMax;
  final int brakeCalibMin;
  final int brakeCalibMax;

  int get accelStroke => accelCalibMax - accelCalibMin;
  int get brakeStroke => brakeCalibMax - brakeCalibMin;

  @override
  bool operator ==(Object other) =>
      other is CalibrationPayload &&
      other.deviceId == deviceId &&
      other.accelCalibMin == accelCalibMin &&
      other.accelCalibMax == accelCalibMax &&
      other.brakeCalibMin == brakeCalibMin &&
      other.brakeCalibMax == brakeCalibMax;

  @override
  int get hashCode => Object.hash(deviceId, accelCalibMin, accelCalibMax, brakeCalibMin, brakeCalibMax);
}

/// 측정 결과 → 저장 계약. 유휴(먼 거리)가 max, 완전 답입(가까운 거리)이 min.
CalibrationPayload? toCalibrationPayload(String deviceId, WizardState state) {
  final c = state.captured;
  final accelIdle = c[CaptureKey.accelIdle];
  final accelFull = c[CaptureKey.accelFull];
  final brakeIdle = c[CaptureKey.brakeIdle];
  final brakeFull = c[CaptureKey.brakeFull];
  if (accelIdle == null || accelFull == null || brakeIdle == null || brakeFull == null) return null;
  return CalibrationPayload(
    deviceId: deviceId,
    accelCalibMin: accelFull,
    accelCalibMax: accelIdle,
    brakeCalibMin: brakeFull,
    brakeCalibMax: brakeIdle,
  );
}
