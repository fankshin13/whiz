// 가상 단말(규격대로 서명·20Hz 알림)로 홈 단말 상태·게이지·보정 쓰기 흐름을 확인한다(기본 폭·320dp)
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:pedaleye_app/core/ble/virtual_pedaleye_device.dart';
import 'package:pedaleye_app/core/sensor/ble_pedal_sensor_source.dart';
import 'package:pedaleye_app/core/text/keep_all.dart';
import 'package:pedaleye_app/core/theme/app_theme.dart';
import 'package:pedaleye_app/features/calibration/domain/driver_device.dart';
import 'package:pedaleye_app/features/device/application/device_link_controller.dart';
import 'package:pedaleye_app/features/device/application/device_log_sync.dart';
import 'package:pedaleye_app/features/device/data/sensor_mode_store.dart';
import 'package:pedaleye_app/features/device/presentation/device_status_card.dart';
import 'package:pedaleye_app/features/gauge/presentation/pedal_gauge_widgets.dart';

import 'fakes.dart';

Future<void> run(WidgetTester tester, Duration duration) async {
  for (var i = 0; i < duration.inMilliseconds ~/ 50; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

/// 비동기 서명·연결이 끝날 때까지 시간을 돌린다
Future<void> until(WidgetTester tester, bool Function() condition) async {
  for (var i = 0; i < 200 && !condition(); i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 5)));
    await tester.pump(const Duration(milliseconds: 50));
  }
  expect(condition(), isTrue, reason: '조건을 기다리다 시간 초과');
}

/// 연결을 끊는 비동기 정리는 실제 시간에서 돌린다(가짜 시간에서는 끝나지 않을 수 있음)
Future<void> stopLink(WidgetTester tester, DeviceLinkController link) async {
  await tester.runAsync(link.stop);
  await tester.pump(const Duration(milliseconds: 100));
}

DriverDevice deviceWith(DriverDevice base, Uint8List? key) => DriverDevice(
  deviceId: base.deviceId,
  serialNumber: base.serialNumber,
  plateNumber: base.plateNumber,
  calibration: base.calibration,
  authPublicKey: key,
);

int litBlocks(WidgetTester tester, GaugePedal pedal, Color color) {
  final gauge = find.byWidgetPredicate((w) => w is PedalLevelGauge && w.pedal == pedal);
  return tester
      .widgetList<Container>(find.descendant(of: gauge, matching: find.byType(Container)))
      .where((c) => c.constraints?.maxHeight == 36 && (c.decoration as BoxDecoration?)?.color == color)
      .length;
}

void main() {
  late VirtualPedalEyeDevice device;
  late Uint8List key;

  // 위젯 테스트의 가짜 시간 안에서는 서명 계산이 끝나지 않을 수 있어 키는 실제 시간에서 만든다
  setUpAll(() async {
    key = await VirtualPedalEyeDevice().publicKey();
  });
  setUp(() => device = VirtualPedalEyeDevice(clock: () => 1794900000000));

  Future<(DeviceLinkController, FakeDeviceRepository)> pumpBle(WidgetTester tester, DriverDevice assigned) async {
    final devices = FakeDeviceRepository(assigned);
    late DeviceLinkController link;
    await pumpApp(
      tester,
      auth: fakeAuth(signedInAs: driverId),
      devices: devices,
      sensorMode: SensorModeStore(null, initial: SensorMode.virtual),
      deviceLink: (session) => link = DeviceLinkController(
        transport: VirtualBleTransport(devices: [device]),
        devices: devices,
        currentUserId: () => session.userId,
        delay: (_) => Future<void>.delayed(const Duration(milliseconds: 10)),
      ),
      sensorFactory: () => BlePedalSensorSource(link),
      settle: false,
    );
    return (link, devices);
  }

  for (final narrow in [false, true]) {
    final width = narrow ? '320dp' : '기본 폭';

    testWidgets('[$width] 홈에 단말 연결 상태가 나오고, 인증된 단말의 실시간 데이터로 게이지가 움직인다', (tester) async {
      if (narrow) useNarrowPhone(tester);
      final (link, _) = await pumpBle(tester, deviceWith(calibratedDevice, key));
      await until(tester, () => link.status == DeviceLinkStatus.connected);
      await tester.pump();
      expect(find.text(keepAll(connectedMessage)), findsOneWidget);
      expect(find.text('단말 PE-2026-000001'), findsOneWidget);

      await tester.ensureVisible(find.text('실시간 페달 게이지'));
      await tester.tap(find.text('실시간 페달 게이지'));
      await run(tester, const Duration(milliseconds: 300));
      device.accelPress = 1;
      await run(tester, const Duration(milliseconds: 400));
      expect(litBlocks(tester, GaugePedal.accel, AppColors.accel), 5);
      device.accelPress = 0;
      device.brakePress = 1;
      await run(tester, const Duration(milliseconds: 400));
      expect(litBlocks(tester, GaugePedal.brake, AppColors.brake), 5);
      expect(tester.takeException(), isNull);
      await stopLink(tester, link);
    });

    testWidgets('[$width] 위조 단말은 인증 실패를 크게 알리고 연결하지 않는다', (tester) async {
      if (narrow) useNarrowPhone(tester);
      device.authBehavior = VirtualAuthBehavior.wrongKey;
      final (link, _) = await pumpBle(tester, deviceWith(calibratedDevice, key));
      await until(tester, () => link.status == DeviceLinkStatus.authFailed);
      await tester.pump();
      expect(find.text('인증 실패'), findsOneWidget);
      expect(find.text(keepAll(authFailedMessage)), findsOneWidget);
      expect(device.isConnected, isFalse);
      expect(tester.takeException(), isNull);
      await stopLink(tester, link);
    });
  }

  testWidgets('공개키 미등록 단말은 경고·동의 후에만 연결한다', (tester) async {
    final (link, _) = await pumpBle(tester, deviceWith(calibratedDevice, null));
    await until(tester, () => link.status == DeviceLinkStatus.testDeviceConsentRequired);
    await tester.pump();
    expect(find.text(keepAll(testDeviceMessage)), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, '시험 단말로 연결'));
    await run(tester, const Duration(milliseconds: 500));
    await tester.tap(find.widgetWithText(FilledButton, '연결'));
    await tester.pump();
    await until(tester, () => link.status == DeviceLinkStatus.connected);
    await stopLink(tester, link);
  });

  testWidgets('보정 결과는 단말에 먼저 쓰고, 단말이 거부하면 서버에 저장하지 않는다', (tester) async {
    final (link, devices) = await pumpBle(tester, deviceWith(factoryDevice, key));
    await until(tester, () => link.status == DeviceLinkStatus.connected);
    await tester.tap(find.text('페달 보정').last);
    await run(tester, const Duration(milliseconds: 300));

    Future<void> capture() async {
      final button = find.widgetWithText(FilledButton, '측정 시작 (3초)');
      await tester.ensureVisible(button);
      await tester.tap(button);
      await run(tester, const Duration(milliseconds: 3300));
    }

    await capture(); // 가속 0%
    device.accelPress = 1;
    await capture();
    device.accelPress = 0;
    await capture(); // 제동 0%
    device.brakePress = 1;
    await capture();
    device.brakePress = 0;

    device.rejectCalibration = true;
    final apply = find.text('보정값 적용하기');
    await tester.ensureVisible(apply);
    await tester.tap(apply);
    await until(tester, () => find.text('단말 저장 실패').evaluate().isNotEmpty);
    expect(devices.saved, isEmpty);

    device.rejectCalibration = false;
    await tester.tap(find.widgetWithText(FilledButton, '다시 시도'));
    await until(tester, () => devices.saved.isNotEmpty);
    expect(device.calibration.accelMin, devices.saved.single.accelCalibMin);
    expect(device.calibration.brakeMax, devices.saved.single.brakeCalibMax);
    await stopLink(tester, link);
  });

  testWidgets('센서 설정에서 고른 방식은 파일에 저장되어 앱을 다시 켜도 유지된다', (tester) async {
    useNarrowPhone(tester);
    final dir = (await tester.runAsync(() => Directory.systemTemp.createTemp('sensor-mode')))!;
    addTearDown(() => dir.deleteSync(recursive: true));
    final file = File('${dir.path}/settings/sensor_mode.json');
    final store = SensorModeStore(file);
    await pumpApp(tester, auth: fakeAuth(signedInAs: driverId), sensorMode: store);
    await tester.ensureVisible(find.text('센서 설정(개발용)'));
    await tester.tap(find.text('센서 설정(개발용)'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('가상 단말(개발용)'));
    await tester.pump();
    expect(store.mode, SensorMode.virtual);
    // 파일 쓰기(실제 입출력)가 끝나도록 실제 시간과 가짜 시간을 번갈아 돌린다
    for (var i = 0; i < 10; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
      await tester.pump();
    }
    final reloaded = (await tester.runAsync(() => SensorModeStore.load(file)))!;
    expect(reloaded.mode, SensorMode.virtual);
    expect(tester.takeException(), isNull);
  });

  testWidgets('[320dp] 단말 사고 기록 백업 진행률과 완료를 홈에 보여 주고, 서버 검증 뒤 단말에 보관 완료를 보낸다', (tester) async {
    useNarrowPhone(tester);
    final stored = (await tester.runAsync(() => device.recordSession(records: 1500)))!;
    final devices = FakeDeviceRepository(deviceWith(calibratedDevice, key));
    late DeviceLinkController link;
    DeviceLogSync? sync;
    await pumpApp(
      tester,
      auth: fakeAuth(signedInAs: driverId),
      devices: devices,
      sensorMode: SensorModeStore(null, initial: SensorMode.virtual),
      deviceLink: (session) => link = DeviceLinkController(
        transport: VirtualBleTransport(devices: [device]),
        devices: devices,
        currentUserId: () => session.userId,
        delay: (_) => Future<void>.delayed(const Duration(milliseconds: 10)),
      ),
      deviceLogSync: (l, events) => sync = DeviceLogSync(link: l!, events: events, partials: MemoryPartialDownloadStore())..attach(),
      virtualDevice: device,
      sensorFactory: () => BlePedalSensorSource(link),
      settle: false,
    );
    await until(tester, () => sync!.phase == LogSyncPhase.downloading && sync!.receivedBytes > 0);
    await tester.pump();
    expect(find.text('단말 사고 기록 백업 중'), findsOneWidget);
    expect(find.textContaining('% ('), findsOneWidget);
    expect(find.textContaining('/ 96.0 KB'), findsOneWidget);
    await until(tester, () => stored.archived);
    await tester.pump();
    expect(find.text('백업 완료'), findsOneWidget);
    expect(find.text(keepAll(logSyncDoneMessage)), findsOneWidget);
    expect(tester.takeException(), isNull);
    await stopLink(tester, link);
    sync!.dispose();
  });
}
