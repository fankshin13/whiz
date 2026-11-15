// 디자인 확인용 화면 캡처. 실행: flutter test test_local/screenshots_test.dart --update-goldens
// 결과는 build/screenshots/ 에 저장된다(저장소에는 넣지 않음).
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:pedaleye_app/core/sensor/mock_pedal_sensor_source.dart';
import 'package:pedaleye_app/features/home/domain/driver_home_data.dart';

import '../test/fakes.dart';

Future<void> run(WidgetTester tester, int ms) async {
  for (var i = 0; i < ms ~/ 50; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

Future<void> loadFonts() async {
  final pretendard = FontLoader('Pretendard');
  for (final weight in ['Regular', 'SemiBold', 'Bold']) {
    pretendard.addFont(rootBundle.load('assets/fonts/Pretendard-$weight.otf'));
  }
  await pretendard.load();
  final flutterRoot = Platform.environment['FLUTTER_ROOT'] ?? '/opt/flutter';
  final icons = File('$flutterRoot/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf');
  final iconLoader = FontLoader('MaterialIcons')
    ..addFont(Future.value(ByteData.sublistView(await icons.readAsBytes())));
  await iconLoader.load();
}

void main() {
  setUpAll(loadFonts);
  final token = 'cd' * 32;

  for (final width in [320.0, 412.0]) {
    Future<void> shot(WidgetTester tester, String name) async {
      await tester.pump();
      await expectLater(find.byType(MaterialApp), matchesGoldenFile('../build/screenshots/${width.toInt()}-$name.png'));
    }

    void size(WidgetTester tester) {
      tester.view.physicalSize = Size(width * 2, 800 * 2);
      tester.view.devicePixelRatio = 2;
      addTearDown(tester.view.reset);
    }

    testWidgets('$width 로그인·오류', (tester) async {
      size(tester);
      await pumpApp(tester, auth: fakeAuth());
      await shot(tester, '01-login');
      await tester.enterText(find.widgetWithText(TextFormField, '이메일'), 'driver.a@pedaleye.test');
      await tester.enterText(find.widgetWithText(TextFormField, '비밀번호'), 'wrong');
      await tester.tap(find.widgetWithText(FilledButton, '로그인'));
      await tester.pumpAndSettle();
      await shot(tester, '02-login-error');
    });

    testWidgets('$width 홈 3종', (tester) async {
      size(tester);
      await pumpApp(tester, auth: fakeAuth(signedInAs: driverId));
      await shot(tester, '03-home');
    });

    testWidgets('$width 홈 빈 상태', (tester) async {
      size(tester);
      await pumpApp(
        tester,
        auth: fakeAuth(signedInAs: driverId),
        home: FakeHomeRepository(const DriverHomeData(userId: driverId, driverName: '김운전', orgName: '화성시 교통안전과')),
      );
      await shot(tester, '04-home-empty');
    });

    testWidgets('$width 운전자 아님', (tester) async {
      size(tester);
      await pumpApp(tester, auth: fakeAuth(signedInAs: adminId));
      await shot(tester, '05-not-driver');
    });

    testWidgets('$width 초대', (tester) async {
      size(tester);
      final invites = fakeInvites(
        (path, _) => path.endsWith('/verify')
            ? (
                200,
                {
                  'isValid': true,
                  'email': 'new.driver@pedaleye.test',
                  'inviteeName': '박신입',
                  'orgName': '서울법인택시',
                  'vehiclePlate': '서울32바 1234',
                },
              )
            : (400, {'success': false, 'error': 'ALREADY_USED'}),
      );
      await pumpApp(tester, auth: fakeAuth(), invites: invites);
      await tester.tap(find.widgetWithText(TextButton, '초대 수락'));
      await tester.pumpAndSettle();
      await shot(tester, '06-invite-code');
      await tester.enterText(find.widgetWithText(TextFormField, '초대 링크 또는 코드'), token);
      await tester.tap(find.widgetWithText(FilledButton, '초대 확인'));
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextFormField, '새 비밀번호'), 'abcdefgh1');
      await tester.enterText(find.widgetWithText(TextFormField, '비밀번호 확인'), 'abcdefgh2');
      await tester.pumpAndSettle();
      await shot(tester, '07-invite-password');
      await tester.enterText(find.widgetWithText(TextFormField, '비밀번호 확인'), 'abcdefgh1');
      await tester.ensureVisible(find.widgetWithText(FilledButton, '가입 및 로그인 완료'));
      await tester.tap(find.widgetWithText(FilledButton, '가입 및 로그인 완료'));
      await tester.pumpAndSettle();
      await shot(tester, '08-invite-unusable');
    });

    testWidgets('$width 캘리브레이션', (tester) async {
      size(tester);
      final sensors = FakeSensors();
      await pumpApp(
        tester,
        auth: fakeAuth(signedInAs: driverId),
        sensors: sensors,
        devices: FakeDeviceRepository(factoryDevice),
      );
      await tester.tap(find.text('페달 보정').last);
      await run(tester, 300);
      await shot(tester, '09-calibrate-step1');
      Future<void> cap() async {
        final b = find.byWidgetPredicate((w) => w is FilledButton).first;
        await tester.ensureVisible(b);
        await tester.tap(b);
        await run(tester, 3300);
      }

      await cap();
      sensors.last.setPress(accel: 0.05);
      await cap();
      await tester.scrollUntilVisible(find.textContaining('2단계:'), -100);
      await run(tester, 100);
      await shot(tester, '10-calibrate-shallow');
      sensors.last.setPress(accel: 1);
      await cap();
      sensors.last.setPress(accel: 0);
      await cap();
      sensors.last.setPress(brake: 1);
      await cap();
      sensors.last.setPress(brake: 0.4, accel: 0);
      await tester.scrollUntilVisible(find.text('보정 완료'), -100);
      await run(tester, 200);
      await shot(tester, '11-calibrate-complete');
    });

    testWidgets('$width 게이지', (tester) async {
      size(tester);
      final sensors = FakeSensors();
      await pumpApp(
        tester,
        auth: fakeAuth(signedInAs: driverId),
        sensors: sensors,
      );
      await tester.tap(find.text('실시간 페달 게이지'));
      await run(tester, 300);
      sensors.last.setPress(accel: 0.65);
      await run(tester, 200);
      await shot(tester, 'zz-warmup'); // 첫 캡처는 이전 합성 결과가 찍히는 경우가 있어 한 번 버린다
      await run(tester, 100);
      await shot(tester, '12-gauge-accel');
      sensors.last.setPress(accel: 0.3, brake: 0.4);
      await run(tester, 450);
      await shot(tester, '13-gauge-dual');
      sensors.last.setPress(accel: 0, brake: 0);
      sensors.last.setScenario(MockPedalScenario.sensorTimeout);
      await run(tester, 3300);
      await shot(tester, '14-gauge-lost');
    });
  }
}
