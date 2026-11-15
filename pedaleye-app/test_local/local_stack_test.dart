// 로컬 Supabase + 로컬 웹 서버(pnpm start)를 대상으로 앱의 실제 저장소 코드를 검증한다.
// 원격·운영 DB 에는 실행하지 않는다. 실행: scripts/test-local-stack.sh
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pedaleye_app/features/auth/data/auth_repository.dart';
import 'package:pedaleye_app/features/auth/data/invite_repository.dart';
import 'package:pedaleye_app/features/auth/domain/invitation.dart';
import 'package:pedaleye_app/features/auth/domain/user_role.dart';
import 'package:pedaleye_app/features/home/data/driver_home_repository.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

const supabaseUrl = String.fromEnvironment('SUPABASE_URL');
const anonKey = String.fromEnvironment('SUPABASE_ANON_KEY');
const webApi = String.fromEnvironment('WEB_API_BASE_URL');
const password = 'Pedaleye-Test-2026!';
const unassignedVehicle = '30000000-0000-0000-0000-000000000004';

SupabaseClient newClient() =>
    SupabaseClient(supabaseUrl, anonKey, authOptions: const AuthClientOptions(autoRefreshToken: false));

/// 웹 콘솔과 같은 방식(256비트 난수 → DB 에는 SHA-256 해시만)으로 관리자가 초대를 만든다(RLS 허용 범위)
Future<(String token, String email)> createInvitation({Duration expiresIn = const Duration(hours: 24)}) async {
  final admin = newClient();
  final session = await admin.auth.signInWithPassword(email: 'admin.hwaseong@pedaleye.test', password: password);
  final random = Random.secure();
  final token = List.generate(32, (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
  final email = 'app-it-${DateTime.now().millisecondsSinceEpoch}@pedaleye.test';
  await admin.from('invitations').insert({
    'org_id': '10000000-0000-0000-0000-000000000001',
    'vehicle_id': unassignedVehicle,
    'email': email,
    'invitee_name': '앱 통합',
    'role': 'driver',
    'token_hash': sha256.convert(token.codeUnits).toString(),
    'expires_at': DateTime.now().toUtc().add(expiresIn).toIso8601String(),
    'created_by': session.user!.id,
  });
  return (token, email);
}

void main() {
  if (supabaseUrl.isEmpty || webApi.isEmpty) {
    test('로컬 스택 설정 없음', () {}, skip: 'scripts/test-local-stack.sh 로 실행하세요');
    return;
  }

  group('Supabase 인증·역할', () {
    test('운전자 로그인 → 역할 driver, 홈에 본인 배정 차량', () async {
      final client = newClient();
      final auth = SupabaseAuthRepository(client);
      await auth.signIn(email: 'driver.a@pedaleye.test', password: password);
      final uid = auth.currentUserId!;
      expect(await auth.fetchRole(uid), UserRole.driver);

      final home = await SupabaseDriverHomeRepository(client).load(uid);
      expect(home.driverName, '화성 운전자 A');
      expect(home.orgName, '화성시 교통안전과');
      expect(home.assignedVehicle?.plateNumber, '12가 3456');
      expect(home.assignedVehicle?.modelLabel, '아반떼 (2021년형)');
    });

    test('관리자·조사관은 운전자가 아니다', () async {
      for (final email in [
        'admin.hwaseong@pedaleye.test',
        'investigator.hwaseong@pedaleye.test',
        'super@pedaleye.test',
      ]) {
        final auth = SupabaseAuthRepository(newClient());
        await auth.signIn(email: email, password: password);
        expect((await auth.fetchRole(auth.currentUserId!)).canUseApp, isFalse, reason: email);
      }
    });

    test('잘못된 비밀번호는 invalidCredentials', () async {
      final auth = SupabaseAuthRepository(newClient());
      await expectLater(
        auth.signIn(email: 'driver.a@pedaleye.test', password: 'wrong-password'),
        throwsA(isA<SignInException>().having((e) => e.failure, 'failure', SignInFailure.invalidCredentials)),
      );
    });

    test('운전자는 다른 사람의 역할을 읽을 수 없다(RLS)', () async {
      final auth = SupabaseAuthRepository(newClient());
      await auth.signIn(email: 'driver.a@pedaleye.test', password: password);
      await expectLater(auth.fetchRole('20000000-0000-0000-0000-000000000002'), throwsA(isA<RoleLookupException>()));
    });
  });

  group('초대 API(웹 서버)', () {
    final invites = InviteRepository(baseUrl: Uri.parse(webApi));

    test('확인 → 수락 → 같은 비밀번호로 로그인 → 홈에 배정 차량, 재사용은 거부', () async {
      final (token, email) = await createInvitation();
      final check = await invites.verify(token);
      expect(
        check,
        isA<ValidInvitation>()
            .having((c) => c.vehiclePlate, 'plate', '56다 1004')
            .having((c) => c.email, 'email', email),
      );

      expect(await invites.accept(token: token, password: 'new-pass-1234'), email);

      final client = newClient();
      final auth = SupabaseAuthRepository(client);
      await auth.signIn(email: email, password: 'new-pass-1234');
      expect(await auth.fetchRole(auth.currentUserId!), UserRole.driver);
      final home = await SupabaseDriverHomeRepository(client).load(auth.currentUserId!);
      expect(home.assignedVehicle?.plateNumber, '56다 1004');

      expect(await invites.verify(token), isA<UnusableInvitation>().having((c) => c.reason, 'reason', 'ALREADY_USED'));
      await expectLater(
        invites.accept(token: token, password: 'new-pass-1234'),
        throwsA(isA<AcceptInviteException>().having((e) => e.failure, 'failure', AcceptFailure.alreadyUsed)),
      );
    });

    test('없는 토큰은 NOT_FOUND', () async {
      expect(await invites.verify('ef' * 32), isA<UnusableInvitation>().having((c) => c.reason, 'reason', 'NOT_FOUND'));
    });
  });
}
