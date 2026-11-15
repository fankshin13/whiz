import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:pedaleye_app/core/forensics/event_recorder.dart';
import 'package:pedaleye_app/core/forensics/packet_codec.dart';
import 'package:pedaleye_app/features/events/application/event_sync_controller.dart';
import 'package:pedaleye_app/features/events/data/event_simulator.dart';
import 'package:pedaleye_app/features/events/data/event_uploader.dart';
import 'package:pedaleye_app/features/events/data/local_event_store.dart';
import 'package:pedaleye_app/features/events/domain/event_models.dart';

import '../fakes.dart';

const device = '40000000-0000-0000-0000-000000000001';
final now = DateTime.utc(2026, 11, 15, 7);

void main() {
  group('모의 사고 기록기', () {
    test('급제동: 60초 1,200개, 급가감속 트리거, 체인·제네시스 유효, 끝 시각이 지금 이전', () {
      final s = EventSimulator.suddenBrake(device, now: now);
      expect((s.triggerType, s.recordCount), (TriggerType.suddenAccel, 1200));
      expect(s.endTimeMs, lessThanOrEqualTo(now.millisecondsSinceEpoch));
      expect(verifyForTest(s.bytes, device).isValid, isTrue);
      expect(decodePacketRecord(s.bytes, 600 * 64).brakePercent, 100);
    });

    test('긴급 백업: 수동 트리거 60초', () {
      final s = EventSimulator.manualBackup(device, now: now);
      expect((s.triggerType, s.recordCount), (TriggerType.manual, 1200));
      expect(verifyForTest(s.bytes, device).isValid, isTrue);
    });
  });

  group('LocalEventStore (실제 파일)', () {
    late Directory root;
    setUp(() async => root = await Directory.systemTemp.createTemp('pel-test'));
    tearDown(() async => root.delete(recursive: true));

    test('원본·상태를 저장하고 다시 읽는다. 다른 사용자 폴더에서는 보이지 않는다', () async {
      final store = LocalEventStore(root);
      final session = EventSimulator.suddenBrake(device, now: now);
      final saved = await store.save('user-a', device, session);
      expect(saved.status, UploadStatus.pending);

      expect(await store.readBytes('user-a', saved.localId), session.bytes);
      final listed = await store.list('user-a');
      expect(listed.single.localId, saved.localId);
      expect(listed.single.recordCount, 1200);
      expect(await store.list('user-b'), isEmpty);

      await store.update(
        'user-a',
        saved.copyWith(status: UploadStatus.completed, serverSessionId: 's1', integrityVerified: true),
      );
      final after = (await store.list('user-a')).single;
      expect((after.status, after.serverSessionId, after.integrityVerified), (UploadStatus.completed, 's1', true));

      // 앱 재시작: 새 저장소 객체도 같은 내용을 읽는다
      expect((await LocalEventStore(root).list('user-a')).single.serverSessionId, 's1');
    });
  });

  group('EventSyncController', () {
    late FakeEventsRepository server;
    late FakeConnectivity net;
    late FakeUploader uploader;
    late MemoryBackupStore store;
    late EventSyncController sync;

    setUp(() async {
      server = FakeEventsRepository();
      net = FakeConnectivity(online: false);
      store = MemoryBackupStore();
      uploader = FakeUploader(server, net);
      sync = EventSyncController(store: store, uploader: uploader, connectivity: net);
      await sync.bind('user-a');
    });

    test('비행기 모드: 기기에 대기로 보관 → 연결되면 자동 업로드, 서버 판정을 기록', () async {
      final outcome = await sync.backup(device, EventSimulator.suddenBrake(device, now: now));
      expect(outcome, BackupOutcome.savedOffline);
      expect(sync.backups.single.status, UploadStatus.pending);
      expect(server.sessions, isEmpty);

      net.set(true);
      await pumpEventQueue();
      await sync.syncPending();
      final b = sync.backups.single;
      expect(
        (b.status, b.integrityVerified, b.serverSessionId),
        (UploadStatus.completed, true, server.sessions.single.id),
      );
    });

    test('같은 세션을 다시 올려도 서버에 하나만 남는다', () async {
      net.set(true);
      final session = EventSimulator.suddenBrake(device, now: now);
      await sync.backup(device, session);
      await sync.backup(device, session);
      expect(server.sessions, hasLength(1));
      expect(sync.backups.map((b) => b.serverSessionId).toSet(), hasLength(1));
    });

    test('1비트 변조본은 서버 판정대로 변조 감지(false)로 기록', () async {
      net.set(true);
      final s = EventSimulator.suddenBrake(device, now: now);
      final tampered = Uint8List.fromList(s.bytes)..[500 * 64 + 14] ^= 0x01;
      await sync.backup(
        device,
        FrozenSession(
          triggerType: s.triggerType,
          triggerAtMs: s.triggerAtMs,
          startTimeMs: s.startTimeMs,
          endTimeMs: s.endTimeMs,
          recordCount: s.recordCount,
          bytes: tampered,
        ),
      );
      expect(sync.backups.single.integrityVerified, isFalse);
      expect(server.sessions.single.integrityVerified, isFalse);
    });

    test('업로드 중 네트워크가 끊기면 대기로 돌아가고, 서버 거절은 이유를 남기고 자동 재시도하지 않는다', () async {
      net.set(true);
      uploader.nextFailure = const UploadException(UploadFailure.network);
      expect(await sync.backup(device, EventSimulator.suddenBrake(device, now: now)), BackupOutcome.savedUploadFailed);
      expect(sync.backups.single.status, UploadStatus.pending);

      uploader.nextFailure = const UploadException(UploadFailure.rejected, '이 단말의 사고 기록을 올릴 권한이 없습니다.');
      await sync.syncPending();
      expect(sync.backups.single.status, UploadStatus.failed);
      expect(sync.backups.single.errorMessage, '이 단말의 사고 기록을 올릴 권한이 없습니다.');

      await sync.syncPending(); // 거절된 건은 다시 보내지 않음
      expect(server.sessions, isEmpty);
    });

    test('서버 일시 오류는 실패로 두되 다음 동기화 때 다시 올린다', () async {
      net.set(true);
      uploader.nextFailure = const UploadException(UploadFailure.server);
      await sync.backup(device, EventSimulator.manualBackup(device, now: now));
      expect(sync.backups.single.status, UploadStatus.failed);
      await sync.syncPending();
      expect(sync.backups.single.status, UploadStatus.completed);
    });

    test('다른 사용자로 바뀌면 이전 사용자의 백업은 보이지 않는다', () async {
      await sync.backup(device, EventSimulator.manualBackup(device, now: now));
      expect(sync.backups, hasLength(1));
      await sync.unbind();
      expect(sync.backups, isEmpty);
    });
  });

  group('HttpEventUploader', () {
    final backup = LocalEventBackup(
      localId: 'l1',
      deviceId: device,
      triggerType: TriggerType.suddenAccel,
      startTimeMs: now.millisecondsSinceEpoch,
      endTimeMs: now.millisecondsSinceEpoch + 59950,
      recordCount: 1200,
      status: UploadStatus.pending,
      createdAtMs: 0,
    );
    final pel = Uint8List.fromList(List.filled(96, 7));

    test('Bearer 토큰과 원본만 보내고 무결성 값은 보내지 않는다', () async {
      late http.Request sent;
      final uploader = HttpEventUploader(
        baseUrl: Uri.parse('https://console.example'),
        accessToken: () async => 'token-123',
        client: MockClient((request) async {
          sent = request;
          return http.Response(
            jsonEncode({'success': true, 'sessionId': 's1', 'integrityVerified': true, 'duplicate': false}),
            200,
          );
        }),
      );
      final outcome = await uploader.upload(backup, pel);
      expect((outcome.sessionId, outcome.integrityVerified, outcome.duplicate), ('s1', true, false));
      expect(sent.url.path, '/api/events/upload');
      expect(sent.headers['authorization'], 'Bearer token-123');
      final body = jsonDecode(sent.body) as Map<String, dynamic>;
      expect(body.keys.toSet(), {'deviceId', 'triggerType', 'startTime', 'endTime', 'rawLogBase64'});
      expect(body['triggerType'], 'sudden_accel');
      expect(base64Decode(body['rawLogBase64'] as String), pel);
      expect(body['startTime'], '2026-11-15T07:00:00.000Z');
    });

    Future<UploadFailure> failureFor(int status) async {
      final uploader = HttpEventUploader(
        baseUrl: Uri.parse('https://console.example'),
        accessToken: () async => 't',
        client: MockClient(
          (_) async => http.Response.bytes(utf8.encode(jsonEncode({'success': false, 'error': '안내'})), status),
        ),
      );
      try {
        await uploader.upload(backup, pel);
      } on UploadException catch (e) {
        return e.failure;
      }
      throw StateError('예외 없음');
    }

    test('응답 코드별 실패 구분, 토큰 없음·연결 끊김', () async {
      expect(await failureFor(401), UploadFailure.unauthorized);
      expect(await failureFor(403), UploadFailure.rejected);
      expect(await failureFor(400), UploadFailure.rejected);
      expect(await failureFor(500), UploadFailure.server);

      final noToken = HttpEventUploader(baseUrl: Uri.parse('https://c'), accessToken: () async => null);
      await expectLater(
        noToken.upload(backup, pel),
        throwsA(isA<UploadException>().having((e) => e.failure, 'f', UploadFailure.unauthorized)),
      );

      final offline = HttpEventUploader(
        baseUrl: Uri.parse('https://c'),
        accessToken: () async => 't',
        client: MockClient((_) async => throw http.ClientException('offline')),
      );
      await expectLater(
        offline.upload(backup, pel),
        throwsA(isA<UploadException>().having((e) => e.failure, 'f', UploadFailure.network)),
      );
    });
  });
}
