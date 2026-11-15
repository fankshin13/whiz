import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:pedaleye_app/features/auth/data/invite_repository.dart';
import 'package:pedaleye_app/features/auth/domain/invitation.dart';

import 'fakes.dart';

void main() {
  final token = 'ab' * 32;

  test('verify: 웹 API 경로로 토큰만 보내고 초대 정보를 읽는다', () async {
    late String calledPath;
    late Map<String, dynamic> sent;
    final repo = fakeInvites((path, body) {
      calledPath = path;
      sent = body;
      return (200, {'isValid': true, 'email': 'd@x.kr', 'inviteeName': '김', 'orgName': '서울법인택시', 'vehiclePlate': null});
    });
    final result = await repo.verify(token);
    expect(calledPath, '/api/invitations/verify');
    expect(sent, {'token': token});
    expect(
      result,
      isA<ValidInvitation>()
          .having((r) => r.orgName, 'orgName', '서울법인택시')
          .having((r) => r.vehiclePlate, 'plate', isNull),
    );
  });

  test('verify: 사용 불가 초대·429·서버 오류를 구분한다', () async {
    expect(
      await fakeInvites((_, _) => (200, {'isValid': false, 'reason': 'EXPIRED'})).verify(token),
      isA<UnusableInvitation>().having((r) => r.reason, 'reason', 'EXPIRED'),
    );
    await expectLater(
      fakeInvites((_, _) => (429, {'error': 'RATE_LIMITED'})).verify(token),
      throwsA(isA<InviteRateLimitedException>()),
    );
    await expectLater(
      fakeInvites((_, _) => (503, <String, Object?>{})).verify(token),
      throwsA(isA<InviteNetworkException>()),
    );
  });

  test('네트워크 단절은 InviteNetworkException', () async {
    final repo = InviteRepository(
      baseUrl: Uri.parse('https://console.example'),
      client: MockClient((_) async => throw http.ClientException('offline')),
    );
    await expectLater(repo.verify(token), throwsA(isA<InviteNetworkException>()));
  });

  test('accept: 성공 시 이메일, 실패 시 서버 사유 코드', () async {
    expect(
      await fakeInvites((_, _) => (200, {'success': true, 'email': 'd@x.kr', 'role': 'driver'}))
          .accept(token: token, password: 'p'),
      'd@x.kr',
    );

    Future<AcceptInviteException> failure(int status, Map<String, Object?> body) async {
      try {
        await fakeInvites((_, _) => (status, body)).accept(token: token, password: 'p');
      } on AcceptInviteException catch (e) {
        return e;
      }
      throw StateError('예외가 없음');
    }

    expect((await failure(400, {'success': false, 'error': 'ALREADY_USED'})).failure.invitationUnusable, isTrue);
    expect((await failure(400, {'success': false, 'error': 'EXPIRED'})).failure, AcceptFailure.expired);
    expect((await failure(400, {'success': false, 'error': 'EMAIL_EXISTS'})).failure, AcceptFailure.emailExists);
    final short = await failure(400, {'success': false, 'error': 'INVALID_INPUT', 'message': '비밀번호는 8자 이상이어야 합니다.'});
    expect(short.serverMessage, '비밀번호는 8자 이상이어야 합니다.');
    expect((await failure(429, {'error': 'RATE_LIMITED'})).failure, AcceptFailure.rateLimited);
    expect((await failure(500, {'success': false, 'error': 'FAILED'})).failure, AcceptFailure.failed);
  });
}
