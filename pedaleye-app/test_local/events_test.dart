// 로컬 Supabase + 로컬 웹 서버 대상: 앱의 실제 업로드·조회 코드로 사고 기록 흐름을 확인한다.
// 실행: scripts/test-local-stack.sh (끝나면 이 테스트가 만든 세션을 지운다)
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:pedaleye_app/core/forensics/event_recorder.dart';
import 'package:pedaleye_app/features/auth/data/auth_repository.dart';
import 'package:pedaleye_app/features/events/data/driver_events_repository.dart';
import 'package:pedaleye_app/features/events/data/event_simulator.dart';
import 'package:pedaleye_app/features/events/data/event_uploader.dart';
import 'package:pedaleye_app/features/events/domain/event_models.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

const supabaseUrl = String.fromEnvironment('SUPABASE_URL');
const anonKey = String.fromEnvironment('SUPABASE_ANON_KEY');
const webApi = String.fromEnvironment('WEB_API_BASE_URL');
const password = 'Pedaleye-Test-2026!';
const deviceA = '40000000-0000-0000-0000-000000000001';
const deviceB = '40000000-0000-0000-0000-000000000002';

Future<SupabaseClient> signIn(String email) async {
  final client = SupabaseClient(supabaseUrl, anonKey, authOptions: const AuthClientOptions(autoRefreshToken: false));
  await SupabaseAuthRepository(client).signIn(email: email, password: password);
  return client;
}

HttpEventUploader uploaderFor(SupabaseClient client) =>
    HttpEventUploader(baseUrl: Uri.parse(webApi), accessToken: () async => client.auth.currentSession?.accessToken);

LocalEventBackup backupOf(String deviceId, FrozenSession s) => LocalEventBackup(
  localId: 'it',
  deviceId: deviceId,
  triggerType: s.triggerType,
  startTimeMs: s.startTimeMs,
  endTimeMs: s.endTimeMs,
  recordCount: s.recordCount,
  status: UploadStatus.pending,
  createdAtMs: 0,
);

void main() {
  if (supabaseUrl.isEmpty || webApi.isEmpty) {
    test('로컬 스택 설정 없음', () {}, skip: 'scripts/test-local-stack.sh 로 실행하세요');
    return;
  }

  // 시각을 겹치지 않게 테스트마다 다르게 둔다
  final base = DateTime.utc(2026, 11, 14, 1);

  test('운전자 A: 업로드 → 서버 검증 통과, 재업로드는 같은 세션, 본인 목록·원본 조회', () async {
    final client = await signIn('driver.a@pedaleye.test');
    final session = EventSimulator.suddenBrake(deviceA, now: base);
    final uploader = uploaderFor(client);

    final first = await uploader.upload(backupOf(deviceA, session), session.bytes);
    expect((first.integrityVerified, first.duplicate), (true, false));
    final again = await uploader.upload(backupOf(deviceA, session), session.bytes);
    expect((again.sessionId, again.duplicate), (first.sessionId, true));

    final repo = SupabaseDriverEventsRepository(client);
    final mine = await repo.listMySessions();
    expect(mine.where((s) => s.id == first.sessionId), hasLength(1));
    expect(mine.every((s) => s.plateNumber == '12가 3456'), isTrue);

    final row = (await repo.getSession(first.sessionId))!;
    expect((row.integrityVerified, row.recordCount, row.triggerType), (true, 1200, TriggerType.suddenAccel));
    expect(await repo.downloadLog(row), session.bytes);
  });

  test('1비트 변조본은 서버가 변조 감지(false)로 저장', () async {
    final client = await signIn('driver.a@pedaleye.test');
    final s = EventSimulator.manualBackup(deviceA, now: base.add(const Duration(minutes: 5)));
    final tampered = Uint8List.fromList(s.bytes)..[500 * 64 + 14] ^= 0x01;
    final outcome = await uploaderFor(client).upload(backupOf(deviceA, s), tampered);
    expect(outcome.integrityVerified, isFalse);
    final row = await SupabaseDriverEventsRepository(client).getSession(outcome.sessionId);
    expect(row?.integrityVerified, isFalse);
  });

  test('운전자 A 는 다른 운전자 단말로 올릴 수 없다(403)', () async {
    final client = await signIn('driver.a@pedaleye.test');
    final s = EventSimulator.manualBackup(deviceB, now: base.add(const Duration(minutes: 10)));
    await expectLater(
      uploaderFor(client).upload(backupOf(deviceB, s), s.bytes),
      throwsA(isA<UploadException>().having((e) => e.failure, 'failure', UploadFailure.rejected)),
    );
  });

  test('다른 운전자(B)·다른 조직 관리자는 A 의 기록을 볼 수 없다', () async {
    final a = await signIn('driver.a@pedaleye.test');
    final aSessions = await SupabaseDriverEventsRepository(a).listMySessions();
    expect(aSessions, isNotEmpty);
    final target = aSessions.first;

    for (final email in ['driver.b@pedaleye.test', 'admin.seoul@pedaleye.test']) {
      final other = SupabaseDriverEventsRepository(await signIn(email));
      expect((await other.listMySessions()).where((s) => s.deviceId == deviceA), isEmpty, reason: email);
      expect(await other.getSession(target.id), isNull, reason: email);
    }
  });
}
