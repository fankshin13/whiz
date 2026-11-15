// 웹 tests/calibration-wizard.test.ts 와 같은 입력·기대값
import 'package:flutter_test/flutter_test.dart';
import 'package:pedaleye_app/core/calibration/calibration_wizard_state_machine.dart';
import 'package:pedaleye_app/core/telemetry/displacement_engine.dart';

SampleSummary capture(int average, {bool stable = true}) =>
    SampleSummary(average: average, spread: 4, kept: 60, total: 60, stable: stable);

WizardState run(List<int> values) => values.fold(WizardState.initial, (state, v) => applyCapture(state, capture(v)));

void main() {
  test('가속 0% → 가속 100% → 제동 0% → 제동 100% 순서로 4단계', () {
    expect(wizardSteps.map((s) => s.key), [
      CaptureKey.accelIdle,
      CaptureKey.accelFull,
      CaptureKey.brakeIdle,
      CaptureKey.brakeFull,
    ]);
  });

  test('4단계를 마치면 유휴=max, 완전 답입=min 으로 저장 계약을 만든다', () {
    final state = run([12050, 8050, 13000, 9500]);
    expect(state.isComplete, isTrue);
    expect(
      toCalibrationPayload('d1', state),
      const CalibrationPayload(
        deviceId: 'd1',
        accelCalibMin: 8050,
        accelCalibMax: 12050,
        brakeCalibMin: 9500,
        brakeCalibMax: 13000,
      ),
    );
  });

  test('흔들린 측정은 단계를 넘기지 않고 재측정을 안내한다', () {
    final state = applyCapture(WizardState.initial, capture(12050, stable: false));
    expect(state.stepIndex, 0);
    expect(state.error, contains('다시 측정'));
  });

  test('가동 범위 5mm 미만이면 해당 페달 이름으로 경고하고 머문다', () {
    final afterIdle = run([12050]);
    final tooShallow = applyCapture(afterIdle, capture(11700)); // 3.5mm
    expect(tooShallow.stepIndex, 1);
    expect(tooShallow.error, contains('가속 페달 가동 범위가 너무 작습니다'));

    final brakeShallow = applyCapture(run([12050, 8050, 13000]), capture(12800));
    expect(brakeShallow.error, contains('제동 페달 가동 범위가 너무 작습니다'));
  });

  test('미완료 상태에서는 저장 계약을 만들지 않고, 처음 상태로 돌아갈 수 있다', () {
    final partial = run([12050, 8050]);
    expect(toCalibrationPayload('d1', partial), isNull);
    expect(WizardState.initial.stepIndex, 0);
    expect(WizardState.initial.captured, isEmpty);
  });
}
