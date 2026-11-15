import 'package:flutter_test/flutter_test.dart';
import 'package:pedaleye_app/features/auth/application/session_controller.dart';

import 'fakes.dart';

void main() {
  test('저장된 세션이 없으면 로그아웃 상태', () async {
    final session = SessionController(fakeAuth());
    await session.start();
    expect(session.status, SessionStatus.signedOut);
  });

  test('저장된 운전자 세션은 역할 확인 후 바로 운전자 상태(앱 재실행)', () async {
    final auth = fakeAuth(signedInAs: driverId);
    final session = SessionController(auth);
    await session.start();
    expect(session.status, SessionStatus.driver);
    expect(session.userId, driverId);
    expect(auth.roleLookups, 1);
  });

  test('로그인할 때마다 역할을 다시 조회하고, 관리자는 notDriver', () async {
    final auth = fakeAuth();
    final session = SessionController(auth);
    await session.start();
    await auth.signIn(email: 'admin.hwaseong@pedaleye.test', password: 'Pedaleye-Test-2026!');
    await pumpEventQueue();
    expect(session.status, SessionStatus.notDriver);

    await session.signOut();
    await pumpEventQueue();
    expect(session.status, SessionStatus.signedOut);

    await auth.signIn(email: 'driver.a@pedaleye.test', password: 'Pedaleye-Test-2026!');
    await pumpEventQueue();
    expect(session.status, SessionStatus.driver);
    expect(auth.roleLookups, 2);
  });

  test('역할 조회 실패는 운전자로 취급하지 않고, 다시 시도할 수 있다', () async {
    final auth = fakeAuth(signedInAs: driverId)..roleLookupFails = true;
    final session = SessionController(auth);
    await session.start();
    expect(session.status, SessionStatus.roleCheckFailed);

    auth.roleLookupFails = false;
    await session.retryRoleCheck();
    expect(session.status, SessionStatus.driver);
  });
}
