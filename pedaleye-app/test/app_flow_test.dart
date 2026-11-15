import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:pedaleye_app/features/auth/presentation/invite_screen.dart';
import 'package:pedaleye_app/features/auth/presentation/login_screen.dart';
import 'package:pedaleye_app/features/auth/presentation/not_driver_screen.dart';
import 'package:pedaleye_app/features/home/domain/driver_home_data.dart';
import 'package:pedaleye_app/features/home/presentation/home_screen.dart';

import 'package:pedaleye_app/core/text/keep_all.dart';
import 'package:pedaleye_app/features/auth/data/auth_repository.dart';

import 'fakes.dart';

const password = 'Pedaleye-Test-2026!';
final token = 'cd' * 32;

Finder field(String label) => find.widgetWithText(TextFormField, label);

Future<void> signInWith(WidgetTester tester, String email, String pw) async {
  await tester.enterText(field('이메일'), email);
  await tester.enterText(field('비밀번호'), pw);
  await tester.tap(find.widgetWithText(FilledButton, '로그인'));
  await tester.pumpAndSettle();
}

void main() {
  for (final narrow in [false, true]) {
    final width = narrow ? '320dp' : '기본 폭';

    group('[$width]', () {
      testWidgets('운전자 로그인 → 홈에 배정 차량 카드, 이름·조직 표시', (tester) async {
        if (narrow) useNarrowPhone(tester);
        await pumpApp(tester, auth: fakeAuth());
        expect(find.byType(LoginScreen), findsOneWidget);

        await signInWith(tester, 'driver.a@pedaleye.test', password);
        expect(find.byType(HomeScreen), findsOneWidget);
        expect(find.text('12가 3456'), findsOneWidget);
        expect(find.text('아이오닉 5 (2024년형)'), findsOneWidget);
        expect(find.text('단말 연결 대기 중'), findsOneWidget);
        expect(find.text('김운전님'), findsOneWidget);
        expect(find.text('화성시 교통안전과'), findsOneWidget);
      });

      testWidgets('잘못된 비밀번호·네트워크 오류 안내', (tester) async {
        if (narrow) useNarrowPhone(tester);
        final auth = fakeAuth();
        await pumpApp(tester, auth: auth);
        await signInWith(tester, 'driver.a@pedaleye.test', 'wrong-password');
        expect(find.text(keepAll(invalidCredentialsMessage)), findsOneWidget);
        expect(find.byType(HomeScreen), findsNothing);

        auth.nextSignInFailure = SignInFailure.network;
        await tester.tap(find.widgetWithText(FilledButton, '로그인'));
        await tester.pumpAndSettle();
        expect(find.text(keepAll(networkErrorMessage)), findsOneWidget);
      });

      testWidgets('관리자 로그인은 운전자 전용 안내로 격리되고 홈 데이터를 읽지 않는다', (tester) async {
        if (narrow) useNarrowPhone(tester);
        final home = FakeHomeRepository(driverHome);
        final auth = fakeAuth();
        await pumpApp(tester, auth: auth, home: home);
        await signInWith(tester, 'admin.hwaseong@pedaleye.test', password);

        expect(find.byType(NotDriverScreen), findsOneWidget);
        expect(find.text(keepAll(notDriverTitle)), findsOneWidget);
        expect(find.text(keepAll(notDriverMessage)), findsOneWidget);
        expect(find.byType(NavigationBar), findsNothing);
        expect(home.loads, 0);

        await tester.tap(find.widgetWithText(FilledButton, '로그아웃'));
        await tester.pumpAndSettle();
        expect(find.byType(LoginScreen), findsOneWidget);
      });

      testWidgets('초대 코드 확인 → 비밀번호 설정 → 가입 후 자동 로그인으로 홈', (tester) async {
        if (narrow) useNarrowPhone(tester);
        final auth = fakeAuth();
        final invites = fakeInvites((path, body) {
          if (path.endsWith('/verify')) {
            return (
              200,
              {
                'isValid': true,
                'email': 'new@pedaleye.test',
                'inviteeName': '박신입',
                'orgName': '화성시 교통안전과',
                'vehiclePlate': '56다 1004',
              },
            );
          }
          // 서버가 계정을 만들었다고 가정하고 가짜 계정을 등록
          auth.accounts['new@pedaleye.test'] = (body['password'] as String, driverId, auth.accounts.values.first.$3);
          return (200, {'success': true, 'email': 'new@pedaleye.test', 'role': 'driver'});
        });
        await pumpApp(tester, auth: auth, invites: invites);

        await tester.tap(find.widgetWithText(TextButton, '초대 수락'));
        await tester.pumpAndSettle();
        await tester.enterText(field('초대 링크 또는 코드'), 'https://pedaleye.vercel.app/auth/invite?token=$token');
        await tester.tap(find.widgetWithText(FilledButton, '초대 확인'));
        await tester.pumpAndSettle();

        expect(find.text('56다 1004'), findsOneWidget);
        expect(find.text('new@pedaleye.test'), findsOneWidget);

        await tester.enterText(field('새 비밀번호'), 'new-password-1');
        await tester.enterText(field('비밀번호 확인'), 'new-password-2');
        await tester.pump();
        expect(find.text(passwordMismatchMessage), findsOneWidget);

        await tester.enterText(field('비밀번호 확인'), 'new-password-1');
        await tester.pump();
        expect(find.text(passwordMismatchMessage), findsNothing);

        await tester.ensureVisible(find.widgetWithText(FilledButton, '가입 및 로그인 완료'));
        await tester.tap(find.widgetWithText(FilledButton, '가입 및 로그인 완료'));
        await tester.pumpAndSettle();
        expect(find.byType(HomeScreen), findsOneWidget);
      });

      testWidgets('만료·사용된 초대는 거부 안내와 로그인 이동 버튼', (tester) async {
        if (narrow) useNarrowPhone(tester);
        await pumpApp(
          tester,
          auth: fakeAuth(),
          invites: fakeInvites((_, _) => (200, {'isValid': false, 'reason': 'ALREADY_USED'})),
        );
        await tester.tap(find.widgetWithText(TextButton, '초대 수락'));
        await tester.pumpAndSettle();
        await tester.enterText(field('초대 링크 또는 코드'), token);
        await tester.tap(find.widgetWithText(FilledButton, '초대 확인'));
        await tester.pumpAndSettle();

        expect(find.text(keepAll(unusableInviteMessage)), findsOneWidget);
        await tester.tap(find.widgetWithText(OutlinedButton, '로그인 화면으로 이동'));
        await tester.pumpAndSettle();
        expect(find.byType(LoginScreen), findsOneWidget);
      });

      testWidgets('비밀번호 설정 중 초대가 만료되면 같은 거부 안내', (tester) async {
        if (narrow) useNarrowPhone(tester);
        final invites = fakeInvites(
          (path, _) => path.endsWith('/verify')
              ? (200, {'isValid': true, 'email': 'n@x.kr', 'inviteeName': '박', 'orgName': '조직', 'vehiclePlate': null})
              : (400, {'success': false, 'error': 'EXPIRED'}),
        );
        await pumpApp(tester, auth: fakeAuth(), invites: invites);
        await tester.tap(find.widgetWithText(TextButton, '초대 수락'));
        await tester.pumpAndSettle();
        await tester.enterText(field('초대 링크 또는 코드'), token);
        await tester.tap(find.widgetWithText(FilledButton, '초대 확인'));
        await tester.pumpAndSettle();
        expect(find.text('배정 예정 차량 없음'), findsOneWidget);

        await tester.enterText(field('새 비밀번호'), 'new-password-1');
        await tester.enterText(field('비밀번호 확인'), 'new-password-1');
        await tester.ensureVisible(find.widgetWithText(FilledButton, '가입 및 로그인 완료'));
        await tester.tap(find.widgetWithText(FilledButton, '가입 및 로그인 완료'));
        await tester.pumpAndSettle();
        expect(find.text(keepAll(unusableInviteMessage)), findsOneWidget);
      });

      testWidgets('잘못된 형식의 초대 코드는 서버에 보내지 않고 안내', (tester) async {
        if (narrow) useNarrowPhone(tester);
        var calls = 0;
        await pumpApp(
          tester,
          auth: fakeAuth(),
          invites: fakeInvites((_, _) {
            calls += 1;
            return (200, <String, Object?>{});
          }),
        );
        await tester.tap(find.widgetWithText(TextButton, '초대 수락'));
        await tester.pumpAndSettle();
        await tester.enterText(field('초대 링크 또는 코드'), '1234');
        await tester.tap(find.widgetWithText(FilledButton, '초대 확인'));
        await tester.pumpAndSettle();
        expect(find.textContaining('형식이 올바르지 않습니다'), findsOneWidget);
        expect(calls, 0);
      });

      testWidgets('배정 차량 없음 → 빈 상태 안내', (tester) async {
        if (narrow) useNarrowPhone(tester);
        await pumpApp(
          tester,
          auth: fakeAuth(signedInAs: driverId),
          home: FakeHomeRepository(const DriverHomeData(userId: driverId, driverName: '김운전', orgName: '화성시 교통안전과')),
        );
        expect(find.text(keepAll(noVehicleMessage)), findsOneWidget);
        expect(find.widgetWithText(OutlinedButton, '새로고침'), findsOneWidget);
      });

      testWidgets('차량 조회 실패 → 오류 안내, 다시 시도로 복구', (tester) async {
        if (narrow) useNarrowPhone(tester);
        final home = FakeHomeRepository(driverHome)..fail = true;
        await pumpApp(
          tester,
          auth: fakeAuth(signedInAs: driverId),
          home: home,
        );
        expect(find.text(keepAll(homeLoadFailedMessage)), findsOneWidget);

        home.fail = false;
        await tester.tap(find.widgetWithText(FilledButton, '다시 시도'));
        await tester.pumpAndSettle();
        expect(find.text('12가 3456'), findsOneWidget);
      });
    });
  }

  testWidgets('저장된 세션이 있으면 앱을 다시 열어도 로그인 없이 홈', (tester) async {
    await pumpApp(tester, auth: fakeAuth(signedInAs: driverId));
    expect(find.byType(LoginScreen), findsNothing);
    expect(find.text('12가 3456'), findsOneWidget);
  });

  testWidgets('역할 확인 실패(오프라인)는 홈을 열지 않고 다시 시도 안내', (tester) async {
    final auth = fakeAuth(signedInAs: driverId)..roleLookupFails = true;
    final home = FakeHomeRepository(driverHome);
    await pumpApp(tester, auth: auth, home: home);
    expect(find.text(keepAll('계정 정보를 확인할 수 없습니다')), findsOneWidget);
    expect(home.loads, 0);

    auth.roleLookupFails = false;
    await tester.tap(find.widgetWithText(FilledButton, '다시 시도'));
    await tester.pumpAndSettle();
    expect(find.byType(HomeScreen), findsOneWidget);
  });

  testWidgets('하단 탭 3개: 홈·페달 보정·사고 기록', (tester) async {
    await pumpApp(tester, auth: fakeAuth(signedInAs: driverId));
    await tester.tap(find.text('페달 보정').last);
    await tester.pumpAndSettle();
    expect(find.text('1단계: 가속 페달 영점(0%)'), findsOneWidget);
    await tester.tap(find.text('사고 기록').last);
    await tester.pumpAndSettle();
    expect(find.textContaining(keepAll('사고 기록 백업')), findsOneWidget);
    await tester.tap(find.text('홈'));
    await tester.pumpAndSettle();
    expect(find.text('12가 3456'), findsOneWidget);
  });

  testWidgets('딥링크로 받은 토큰은 입력 없이 바로 확인', (tester) async {
    var verified = '';
    final session = await pumpApp(
      tester,
      auth: fakeAuth(),
      invites: fakeInvites((_, body) {
        verified = body['token'] as String;
        return (200, {'isValid': false, 'reason': 'EXPIRED'});
      }),
    );
    expect(session.userId, isNull);
    final router = tester.widget<MaterialApp>(find.byType(MaterialApp)).routerConfig!;
    (router as GoRouter).go('pedaleye://invite?token=$token');
    await tester.pumpAndSettle();
    expect(verified, token);
    expect(find.text(keepAll(unusableInviteMessage)), findsOneWidget);
  });
}
