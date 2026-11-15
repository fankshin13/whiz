import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:pedaleye_app/core/text/keep_all.dart';
import 'package:pedaleye_app/features/events/presentation/driver_event_detail_screen.dart';
import 'package:pedaleye_app/features/events/presentation/driver_event_list_screen.dart';
import 'package:pedaleye_app/features/events/presentation/event_widgets.dart';
import 'package:pedaleye_app/features/events/presentation/pedal_timeline_chart.dart';

import '../fakes.dart';

Future<void> openRecords(WidgetTester tester) async {
  await tester.tap(find.text('사고 기록').last);
  await tester.pumpAndSettle();
}

/// 안내 스낵바가 사라질 때까지(4초) 기다린다. 화면 아래 버튼을 가리기 때문
Future<void> waitSnackBar(WidgetTester tester) async {
  await tester.pump(const Duration(seconds: 5));
  await tester.pumpAndSettle();
}

Future<void> tapButton(WidgetTester tester, Finder button) async {
  await tester.ensureVisible(button);
  await tester.pumpAndSettle();
  await tester.tap(button);
  await tester.pumpAndSettle();
}

void main() {
  for (final narrow in [false, true]) {
    final width = narrow ? '320dp' : '기본 폭';

    group('[$width] 내 사고 기록', () {
      testWidgets('기록이 없으면 빈 상태 안내와 시뮬레이션 버튼', (tester) async {
        if (narrow) useNarrowPhone(tester);
        await pumpApp(tester, auth: fakeAuth(signedInAs: driverId));
        await openRecords(tester);
        expect(find.text(keepAll(noEventsTitle)), findsOneWidget);
        expect(find.text(keepAll(noEventsMessage)), findsOneWidget);
        expect(find.widgetWithText(OutlinedButton, '사고 기록 시뮬레이션 실행'), findsOneWidget);
      });

      testWidgets('비행기 모드 급제동 → 기기 보관(업로드 대기) → 연결되면 검증 통과로 바뀜', (tester) async {
        if (narrow) useNarrowPhone(tester);
        final server = FakeEventsRepository();
        final net = FakeConnectivity(online: false);
        await pumpApp(
          tester,
          auth: fakeAuth(signedInAs: driverId),
          events: server,
          eventSync: newEventSync(server: server, connectivity: net),
        );
        await openRecords(tester);

        await tapButton(tester, find.widgetWithText(OutlinedButton, '급제동 시뮬레이션'));
        expect(find.text(backupOfflineMessage), findsOneWidget);
        expect(find.text(keepAll('서버 업로드 대기')), findsOneWidget);
        expect(find.textContaining('로컬 보관 중'), findsOneWidget);

        net.set(true);
        await tester.pumpAndSettle();
        expect(find.text(keepAll('서버 업로드 대기')), findsNothing);
        expect(find.text(keepAll('무결성 검증 통과')), findsOneWidget);
        expect(find.textContaining('서버 동기화 완료'), findsOneWidget);
        expect(find.textContaining('급가감속 감지'), findsOneWidget);
      });

      testWidgets('조회 실패 → 안내와 다시 시도', (tester) async {
        if (narrow) useNarrowPhone(tester);
        final server = FakeEventsRepository()..listFails = true;
        await pumpApp(
          tester,
          auth: fakeAuth(signedInAs: driverId),
          events: server,
        );
        await openRecords(tester);
        expect(find.text(keepAll(eventsLoadFailedMessage)), findsOneWidget);
        server.listFails = false;
        await tapButton(tester, find.widgetWithText(FilledButton, '다시 시도'));
        expect(find.text(keepAll(noEventsTitle)), findsOneWidget);
      });

      testWidgets('서버 기록 상세: 검증 배지·지문·차트·PDF 보고서 버튼', (tester) async {
        if (narrow) useNarrowPhone(tester);
        final server = FakeEventsRepository();
        await pumpApp(
          tester,
          auth: fakeAuth(signedInAs: driverId),
          events: server,
          eventSync: newEventSync(server: server),
        );
        await openRecords(tester);
        await tapButton(tester, find.widgetWithText(FilledButton, '긴급 백업'));
        expect(find.text(backupUploadedMessage), findsOneWidget);

        await tapButton(tester, find.textContaining('수동 긴급 백업'));
        expect(find.byType(DriverEventDetailScreen), findsOneWidget);
        expect(find.text(keepAll('무결성 검증 통과')), findsOneWidget);
        expect(find.textContaining(keepAll('디지털 증거 무결성 검증 완료')), findsOneWidget);
        expect(find.text('최초 해시 지문'), findsOneWidget);
        expect(find.byType(PedalTimelineChart), findsOneWidget);
        expect(find.text('가속 페달'), findsOneWidget);
        expect(find.text('제동 페달'), findsOneWidget);
        expect(find.widgetWithText(FilledButton, 'PDF 보고서 열기'), findsOneWidget);
      });
    });
  }

  testWidgets('기기 보관 기록 상세에서 지금 업로드 → 서버 기록 상세로 이동', (tester) async {
    final server = FakeEventsRepository();
    final net = FakeConnectivity(online: false);
    await pumpApp(
      tester,
      auth: fakeAuth(signedInAs: driverId),
      events: server,
      eventSync: newEventSync(server: server, connectivity: net),
    );
    await openRecords(tester);
    await tapButton(tester, find.widgetWithText(OutlinedButton, '급제동 시뮬레이션'));
    await waitSnackBar(tester);
    await tapButton(tester, find.textContaining('로컬 보관 중'));
    expect(find.textContaining(keepAll('아직 서버 검증 전입니다')), findsOneWidget);

    // 연결 이벤트 없이 사용자가 직접 업로드(연결 표시가 늦는 경우)
    net.online = true;
    await tapButton(tester, find.widgetWithText(FilledButton, '서버로 지금 업로드'));
    expect(find.text(keepAll('무결성 검증 통과')), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'PDF 보고서 열기'), findsOneWidget);
    expect(server.sessions, hasLength(1));
  });

  testWidgets('지금 업로드가 오프라인이면 기기에 그대로 둔다는 안내', (tester) async {
    final net = FakeConnectivity(online: false);
    await pumpApp(
      tester,
      auth: fakeAuth(signedInAs: driverId),
      eventSync: newEventSync(connectivity: net),
    );
    await openRecords(tester);
    await tapButton(tester, find.widgetWithText(OutlinedButton, '급제동 시뮬레이션'));
    await waitSnackBar(tester);
    await tapButton(tester, find.textContaining('로컬 보관 중'));
    await tapButton(tester, find.widgetWithText(FilledButton, '서버로 지금 업로드'));
    expect(find.textContaining(keepAll('기록은 기기에 그대로 보관됩니다')), findsOneWidget);
  });

  testWidgets('변조된 세션은 목록·상세에서 변조 감지로 표시', (tester) async {
    final server = FakeEventsRepository();
    final sync = newEventSync(server: server);
    await pumpApp(
      tester,
      auth: fakeAuth(signedInAs: driverId),
      events: server,
      eventSync: sync,
    );
    // 서버에 변조본이 올라가 있는 상황
    final good = server.addFromPel(
      (await MemoryBackupStore().save('u', calibratedDevice.deviceId, tamperedSession())),
      tamperedSession().bytes,
    );
    expect(good.integrityVerified, isFalse);
    await openRecords(tester);
    expect(find.text(keepAll('해시 체인 불일치 (변조 감지)')), findsOneWidget);
    await tapButton(tester, find.textContaining('급가감속 감지'));
    expect(find.textContaining(keepAll('변조 감지: 원본의 해시 체인이 끊겨 있습니다')), findsOneWidget);
  });

  testWidgets('게이지 화면 상단의 긴급 백업 버튼으로도 기록을 남긴다', (tester) async {
    final server = FakeEventsRepository();
    await pumpApp(
      tester,
      auth: fakeAuth(signedInAs: driverId),
      events: server,
      eventSync: newEventSync(server: server),
    );
    await tester.tap(find.widgetWithText(FilledButton, '실시간 페달 게이지'));
    for (var i = 0; i < 6; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
    await tester.tap(find.widgetWithText(FilledButton, '긴급 백업'));
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
    expect(server.sessions.single.triggerType.dbValue, 'manual');
    expect(find.text(backupUploadedMessage), findsOneWidget);
  });
}
