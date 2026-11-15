import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:pedaleye_app/core/calibration/calibration_wizard_state_machine.dart';
import 'package:pedaleye_app/core/text/keep_all.dart';
import 'package:pedaleye_app/core/theme/app_theme.dart';
import 'package:pedaleye_app/features/calibration/data/device_repository.dart';
import 'package:pedaleye_app/features/calibration/presentation/pedal_calibration_screen.dart';
import 'package:pedaleye_app/features/gauge/presentation/pedal_gauge_screen.dart';
import 'package:pedaleye_app/features/gauge/presentation/pedal_gauge_widgets.dart';

import 'fakes.dart';

/// 화면이 바뀌는 동안 20Hz 센서가 계속 프레임을 만들어 pumpAndSettle 이 끝나지 않으므로 시간만큼 돌린다
Future<void> run(WidgetTester tester, Duration duration) async {
  final steps = duration.inMilliseconds ~/ 50;
  for (var i = 0; i < steps; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

Future<void> tapChip(WidgetTester tester, String label) async {
  final chip = find.widgetWithText(ChoiceChip, label);
  await tester.ensureVisible(chip);
  await tester.pump();
  await tester.tap(chip);
}

Future<void> openCalibration(WidgetTester tester) async {
  await tester.tap(find.text('페달 보정').last);
  await run(tester, const Duration(milliseconds: 300));
}

Future<void> capture(WidgetTester tester) async {
  final button = find.widgetWithText(FilledButton, '측정 시작 (3초)').evaluate().isNotEmpty
      ? find.widgetWithText(FilledButton, '측정 시작 (3초)')
      : find.widgetWithText(FilledButton, '다시 측정');
  await tester.ensureVisible(button);
  await tester.tap(button);
  await run(tester, const Duration(milliseconds: 3300));
}

/// LED 블록 중 켜진(해당 색으로 칠해진) 칸 수
int litBlocks(WidgetTester tester, GaugePedal pedal, Color color) {
  final gauge = find.byWidgetPredicate((w) => w is PedalLevelGauge && w.pedal == pedal);
  return tester
      .widgetList<Container>(find.descendant(of: gauge, matching: find.byType(Container)))
      .where((c) => c.constraints?.maxHeight == 36 && (c.decoration as BoxDecoration?)?.color == color)
      .length;
}

void main() {
  for (final narrow in [false, true]) {
    final width = narrow ? '320dp' : '기본 폭';

    group('[$width] 캘리브레이션', () {
      testWidgets('4단계 측정 → 행정 요약 → 적용하면 보정값 저장 후 게이지로 이동', (tester) async {
        if (narrow) useNarrowPhone(tester);
        final sensors = FakeSensors();
        final devices = FakeDeviceRepository(factoryDevice);
        await pumpApp(
          tester,
          auth: fakeAuth(signedInAs: driverId),
          sensors: sensors,
          devices: devices,
        );
        await openCalibration(tester);
        expect(find.text('1단계: 가속 페달 영점(0%)'), findsOneWidget);

        final mock = sensors.last;
        await capture(tester); // 가속 0%
        expect(find.text('2단계: 가속 페달 최대(100%)'), findsOneWidget);
        expect(find.text('120.50mm'), findsOneWidget);

        mock.setPress(accel: 1);
        await capture(tester);
        mock.setPress(accel: 0);
        await capture(tester); // 제동 0%
        mock.setPress(brake: 1);
        await capture(tester);

        expect(find.text('보정 완료'), findsOneWidget);
        expect(find.text('40.00mm'), findsOneWidget); // 가속 행정 120.50 − 80.50
        expect(find.text('35.00mm'), findsOneWidget); // 제동 행정 130.00 − 95.00

        await tester.ensureVisible(find.widgetWithText(FilledButton, '보정값 적용하기'));
        await tester.tap(find.widgetWithText(FilledButton, '보정값 적용하기'));
        await run(tester, const Duration(milliseconds: 500));

        expect(
          devices.saved.single,
          const CalibrationPayload(
            deviceId: '40000000-0000-0000-0000-000000000001',
            accelCalibMin: 8050,
            accelCalibMax: 12050,
            brakeCalibMin: 9500,
            brakeCalibMax: 13000,
          ),
        );
        expect(find.text(calibrationSavedMessage), findsOneWidget);
        expect(find.byType(PedalGaugeScreen), findsOneWidget);
      });

      testWidgets('끝까지 밟지 않으면(5mm 미만) 같은 단계에서 경고', (tester) async {
        if (narrow) useNarrowPhone(tester);
        final sensors = FakeSensors();
        await pumpApp(
          tester,
          auth: fakeAuth(signedInAs: driverId),
          sensors: sensors,
        );
        await openCalibration(tester);
        await capture(tester);
        sensors.last.setPress(accel: 0.05); // 2mm
        await capture(tester);
        expect(find.text('2단계: 가속 페달 최대(100%)'), findsOneWidget);
        expect(find.text(keepAll(shallowStrokeMessage(Pedal.accel))), findsOneWidget);
        expect(find.widgetWithText(FilledButton, '다시 측정'), findsOneWidget);
      });

      testWidgets('저장 실패 → 안내 팝업, 다시 시도하면 저장', (tester) async {
        if (narrow) useNarrowPhone(tester);
        final sensors = FakeSensors();
        final devices = FakeDeviceRepository(calibratedDevice)..nextSaveFailure = CalibrationSaveFailure.network;
        await pumpApp(
          tester,
          auth: fakeAuth(signedInAs: driverId),
          sensors: sensors,
          devices: devices,
        );
        await openCalibration(tester);
        final mock = sensors.last;
        await capture(tester);
        mock.setPress(accel: 1);
        await capture(tester);
        mock.setPress(accel: 0);
        await capture(tester);
        mock.setPress(brake: 1);
        await capture(tester);

        await tester.ensureVisible(find.widgetWithText(FilledButton, '보정값 적용하기'));
        await tester.tap(find.widgetWithText(FilledButton, '보정값 적용하기'));
        await run(tester, const Duration(milliseconds: 500));
        expect(find.text(calibrationSaveFailedMessage), findsOneWidget);
        expect(devices.saved, isEmpty);

        await tester.tap(find.widgetWithText(FilledButton, '다시 시도'));
        await run(tester, const Duration(milliseconds: 500));
        expect(devices.saved, hasLength(1));
        expect(find.byType(PedalGaugeScreen), findsOneWidget);
      });

      testWidgets('배정 단말이 없으면 안내와 홈 복귀 버튼', (tester) async {
        if (narrow) useNarrowPhone(tester);
        await pumpApp(
          tester,
          auth: fakeAuth(signedInAs: driverId),
          devices: FakeDeviceRepository(null),
        );
        await openCalibration(tester);
        expect(find.text(keepAll(noCalibrationDeviceMessage)), findsOneWidget);
        await tester.tap(find.widgetWithText(OutlinedButton, '홈으로 돌아가기'));
        await tester.pumpAndSettle();
        expect(find.text('12가 3456'), findsOneWidget);
      });
    });

    group('[$width] 실시간 게이지', () {
      Future<FakeSensors> openGauge(WidgetTester tester, {FakeWarningFeedback? feedback}) async {
        final sensors = FakeSensors();
        await pumpApp(
          tester,
          auth: fakeAuth(signedInAs: driverId),
          sensors: sensors,
          feedback: feedback,
        );
        await tester.ensureVisible(find.widgetWithText(FilledButton, '실시간 페달 게이지'));
        await tester.tap(find.widgetWithText(FilledButton, '실시간 페달 게이지'));
        await run(tester, const Duration(milliseconds: 300));
        expect(find.byType(PedalGaugeScreen), findsOneWidget);
        return sensors;
      }

      testWidgets('가속은 청색, 제동은 적색 단계로 20Hz 갱신(한쪽만 켜짐)', (tester) async {
        if (narrow) useNarrowPhone(tester);
        final sensors = await openGauge(tester);
        expect(find.text('대기중'), findsOneWidget);

        sensors.last.setPress(accel: 0.5); // 50% → 3단계
        await run(tester, const Duration(milliseconds: 100));
        expect(find.text('가속 중'), findsOneWidget);
        expect(find.text('50%'), findsOneWidget);
        expect(litBlocks(tester, GaugePedal.accel, AppColors.accel), 3);
        expect(litBlocks(tester, GaugePedal.brake, AppColors.brake), 0);

        sensors.last.setPress(accel: 0, brake: 0.9); // 90% → 5단계
        await run(tester, const Duration(milliseconds: 100));
        expect(find.text('제동 중'), findsOneWidget);
        expect(litBlocks(tester, GaugePedal.brake, AppColors.brake), 5);
        expect(litBlocks(tester, GaugePedal.accel, AppColors.accel), 0);
      });

      testWidgets('양발 동시 조작 → 주황 경고 배너, 진동·경고음 반복', (tester) async {
        if (narrow) useNarrowPhone(tester);
        final feedback = FakeWarningFeedback();
        final sensors = await openGauge(tester, feedback: feedback);
        await tapChip(tester, '양발 조작');
        await run(tester, const Duration(milliseconds: 1300));
        expect(find.text(keepAll(DualWarningBanner.message)), findsOneWidget);
        expect(litBlocks(tester, GaugePedal.accel, AppColors.dualWarning), 5);
        expect(feedback.pulses, greaterThanOrEqualTo(2));

        await tapChip(tester, '직접 조작');
        await run(tester, const Duration(milliseconds: 200));
        final after = feedback.pulses;
        await run(tester, const Duration(seconds: 2));
        expect(feedback.pulses, after);
        expect(find.text(keepAll(DualWarningBanner.message)), findsNothing);
        expect(sensors.created, hasLength(1));
      });

      testWidgets('3초 신호 끊김 → 안내 오버레이, 재연결하면 사라짐', (tester) async {
        if (narrow) useNarrowPhone(tester);
        await openGauge(tester);
        await tapChip(tester, '신호 끊김');
        await run(tester, const Duration(milliseconds: 2900));
        expect(find.text(keepAll(sensorLostMessage)), findsNothing);
        await run(tester, const Duration(milliseconds: 300));
        expect(find.text(keepAll(sensorLostMessage)), findsOneWidget);

        await tester.tap(find.widgetWithText(FilledButton, '센서 재연결'));
        await run(tester, const Duration(milliseconds: 300));
        expect(find.text(keepAll(sensorLostMessage)), findsNothing);
      });
    });
  }

  testWidgets('보정 전 단말은 게이지 대신 보정 안내', (tester) async {
    await pumpApp(
      tester,
      auth: fakeAuth(signedInAs: driverId),
      devices: FakeDeviceRepository(factoryDevice),
    );
    await tester.tap(find.widgetWithText(FilledButton, '실시간 페달 게이지'));
    await tester.pumpAndSettle();
    expect(find.text(keepAll('먼저 페달 보정을 진행해 주세요.')), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, '페달 보정 시작하기'));
    await run(tester, const Duration(milliseconds: 300));
    expect(find.byType(PedalCalibrationScreen), findsOneWidget);
  });

  testWidgets('게이지 화면은 운전자만(로그아웃 상태면 로그인으로)', (tester) async {
    await pumpApp(tester, auth: fakeAuth());
    expect(find.byType(PedalGaugeScreen), findsNothing);
  });

  testWidgets('단말 조회 실패 → 다시 시도로 복구(보정·게이지)', (tester) async {
    final devices = FakeDeviceRepository(calibratedDevice)..loadFails = true;
    await pumpApp(
      tester,
      auth: fakeAuth(signedInAs: driverId),
      devices: devices,
    );
    await openCalibration(tester);
    expect(find.text(keepAll('단말기 정보를 불러올 수 없습니다.')), findsOneWidget);
    devices.loadFails = false;
    await tester.tap(find.widgetWithText(FilledButton, '다시 시도'));
    await run(tester, const Duration(milliseconds: 300));
    expect(find.text('1단계: 가속 페달 영점(0%)'), findsOneWidget);

    devices.loadFails = true;
    await tester.tap(find.text('홈'));
    await run(tester, const Duration(milliseconds: 300));
    await tester.tap(find.widgetWithText(FilledButton, '실시간 페달 게이지'));
    await run(tester, const Duration(milliseconds: 300));
    expect(find.text(keepAll('단말기 정보를 불러올 수 없습니다.')), findsOneWidget);
    devices.loadFails = false;
    await tester.tap(find.widgetWithText(FilledButton, '다시 시도'));
    await run(tester, const Duration(milliseconds: 300));
    expect(find.text('대기중'), findsOneWidget);
  });
}
