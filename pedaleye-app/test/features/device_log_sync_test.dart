import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:pedaleye_app/core/ble/virtual_pedaleye_device.dart';
import 'package:pedaleye_app/core/forensics/hash_chain.dart';
import 'package:pedaleye_app/features/calibration/domain/driver_device.dart';
import 'package:pedaleye_app/features/device/application/device_link_controller.dart';
import 'package:pedaleye_app/features/device/application/device_log_sync.dart';
import 'package:pedaleye_app/features/events/application/event_sync_controller.dart';
import 'package:pedaleye_app/features/events/domain/event_models.dart';

import '../fakes.dart';

// 가상 단말의 사고 기록을 BLE 로 받아 백업·업로드하고, 서버 검증 뒤에만 단말에 보관 완료를 알리는지 확인한다
Future<void> until(bool Function() condition, {Duration timeout = const Duration(seconds: 20)}) async {
  final end = DateTime.now().add(timeout);
  while (!condition()) {
    if (DateTime.now().isAfter(end)) throw TimeoutException('조건을 기다리다 시간 초과');
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
}

class Rig {
  Rig._(this.device, this.link, this.events, this.sync, this.partials, this.server, this.net, this.store);

  final VirtualPedalEyeDevice device;
  final DeviceLinkController link;
  final EventSyncController events;
  final DeviceLogSync sync;
  final MemoryPartialDownloadStore partials;
  final FakeEventsRepository server;
  final FakeConnectivity net;
  final MemoryBackupStore store;

  static Future<Rig> create({bool online = true}) async {
    final device = VirtualPedalEyeDevice();
    final key = await device.publicKey();
    final assigned = DriverDevice(
      deviceId: calibratedDevice.deviceId,
      serialNumber: device.serial,
      plateNumber: calibratedDevice.plateNumber,
      calibration: calibratedDevice.calibration,
      authPublicKey: key,
    );
    final link = DeviceLinkController(
      transport: VirtualBleTransport(devices: [device]),
      devices: FakeDeviceRepository(assigned),
      currentUserId: () => driverId,
      delay: (_) => Future<void>.delayed(const Duration(milliseconds: 10)),
    );
    final server = FakeEventsRepository();
    final net = FakeConnectivity(online: online);
    final store = MemoryBackupStore();
    final events = newEventSync(server: server, connectivity: net, store: store);
    await events.bind(driverId);
    final partials = MemoryPartialDownloadStore();
    final sync = DeviceLogSync(link: link, events: events, partials: partials, chunkTimeout: const Duration(milliseconds: 300))..attach();
    return Rig._(device, link, events, sync, partials, server, net, store);
  }

  Future<void> dispose() async {
    await link.stop();
    await sync.syncNow().catchError((_) {});
    sync.dispose();
  }
}

void main() {
  test('정상: 3,000레코드 기록을 받아 검증·백업·업로드하고, 서버 검증 통과 뒤에만 보관 완료를 보낸다', () async {
    final rig = await Rig.create();
    final stored = await rig.device.recordSession();
    expect(stored.pel.length, 3000 * 64 + 32);
    rig.link.start();
    await until(() => stored.archived);

    final backup = rig.events.backups.single;
    expect(backup.status, UploadStatus.completed);
    expect(backup.integrityVerified, isTrue);
    expect(backup.seal?.sessionIndex, stored.index);
    expect(backup.seal?.serial, 'PE-2026-000001');
    expect(rig.store.bytes.values.single, stored.pel);
    expect(rig.device.commandLog.take(3), ['LIST 0', 'START 1@0', 'CONFIRM 1']);
    expect(rig.device.commandLog.where((c) => c.startsWith('START')), hasLength(1));
    expect(rig.partials.files, isEmpty);
    expect(rig.sync.phase, LogSyncPhase.done);
    await rig.dispose();
  });

  test('빠진 청크·CRC8 오류 청크는 다시 요청해 같은 파일을 완성한다', () async {
    final rig = await Rig.create();
    final stored = await rig.device.recordSession();
    rig.device
      ..dropChunkOnce = 10
      ..corruptChunkOnce = 20;
    rig.link.start();
    await until(() => stored.archived);
    expect(rig.store.bytes.values.single, stored.pel);
    expect(rig.device.dropChunkOnce, isNull);
    expect(rig.device.corruptChunkOnce, isNull);
    expect(rig.device.commandLog.where((c) => c.startsWith('START')), ['START 1@0']); // 재시작 없이 NACK 로 복구
    await rig.dispose();
  });

  test('전송 50%에서 끊기면 재연결 뒤 받은 곳부터 이어받아 완성한다', () async {
    final rig = await Rig.create();
    final stored = await rig.device.recordSession();
    rig.device.disconnectAtFraction = 0.5;
    rig.link.start();
    await until(() => stored.archived);
    final starts = rig.device.commandLog.where((c) => c.startsWith('START')).toList();
    expect(starts.first, 'START 1@0');
    expect(starts.length, 2);
    final resumedAt = int.parse(starts.last.split('@').last);
    expect(resumedAt, greaterThan(stored.pel.length * 0.4));
    expect(rig.store.bytes.values.single, stored.pel);
    await rig.dispose();
  });

  test('변조된 기록은 보존·업로드하되 검증 실패로 표시하고, 단말에 보관 완료를 보내지 않는다', () async {
    final rig = await Rig.create();
    final stored = await rig.device.recordSession(tamper: true);
    rig.link.start();
    await until(() => rig.events.backups.isNotEmpty && rig.events.backups.single.status == UploadStatus.completed);
    await until(() => rig.sync.phase == LogSyncPhase.failed && !rig.sync.busy);
    expect(rig.events.backups.single.integrityVerified, isFalse);
    expect(rig.sync.lastSessionTampered, isTrue);
    expect(rig.sync.message, contains('위·변조가 감지'));
    expect(stored.archived, isFalse);
    expect(rig.device.commandLog.any((c) => c.startsWith('CONFIRM')), isFalse);
    await rig.dispose();
  });

  test('오프라인이면 기기에만 보관하고 단말 원본은 지우게 하지 않다가, 연결되어 업로드·검증되면 보관 완료를 보낸다', () async {
    final rig = await Rig.create(online: false);
    final stored = await rig.device.recordSession();
    rig.link.start();
    await until(() => rig.events.backups.isNotEmpty && rig.sync.phase == LogSyncPhase.uploading);
    expect(rig.sync.message, logSyncUploadPendingMessage);
    expect(rig.events.backups.single.status, UploadStatus.pending);
    expect(stored.archived, isFalse);

    rig.net.set(true); // 네트워크 복귀 → 자동 업로드 → 보관 완료
    await until(() => stored.archived);
    expect(rig.device.commandLog.where((c) => c.startsWith('START')).length, 1); // 다시 받지 않음
    await rig.dispose();
  });

  test('전체 CRC-32 가 맞지 않으면 처음부터 한 번 더 받는다', () async {
    final rig = await Rig.create();
    final stored = await rig.device.recordSession(records: 300);
    rig.device.wrongCrc32Once = true;
    rig.link.start();
    await until(() => stored.archived);
    expect(rig.device.commandLog.where((c) => c.startsWith('START')), ['START 1@0', 'START 1@0']);
    expect(rig.store.bytes.values.single, Uint8List.fromList(stored.pel));
    expect(toHex(stored.finalHash), rig.events.backups.single.seal?.finalHashHex);
    await rig.dispose();
  });

  test('보관할 기록이 없으면 아무것도 하지 않는다', () async {
    final rig = await Rig.create();
    rig.link.start();
    await until(() => rig.link.isConnected);
    await until(() => rig.device.commandLog.contains('LIST 0'));
    await Future<void>.delayed(const Duration(milliseconds: 400));
    expect(rig.events.backups, isEmpty);
    expect(rig.sync.phase, LogSyncPhase.idle);
    await rig.dispose();
  });
}
