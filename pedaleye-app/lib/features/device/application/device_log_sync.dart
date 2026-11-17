/// 단말에 보관된 사고 기록(.pel)을 BLE 로 받아 기존 '기기 보관 → 자동 업로드' 흐름에 넣는다(docs/ble-protocol.md 5장).
///
/// 순서: LIST → (아직 보관 완료가 아닌 기록마다) 이어받기 다운로드(청크 CRC8·순서 확인, NACK·재시작)
/// → CRC-32 → 해시 체인(일련번호 시작값) → 봉인 서명 → 기기 백업 → 서버 업로드
/// → 서버가 무결성 검증 통과로 응답한 기록만 단말에 CONFIRM_ARCHIVED(그 전에는 단말 원본을 지우게 하지 않음).
library;

import 'dart:async';
import 'dart:collection';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';

import '../../../core/ble/ble_protocol.dart';
import '../../../core/ble/ble_transport.dart';
import '../../../core/forensics/event_recorder.dart';
import '../../../core/forensics/hash_chain.dart';
import '../../../core/forensics/packet_codec.dart';
import '../../calibration/domain/driver_device.dart';
import '../../events/application/event_sync_controller.dart';
import '../../events/domain/event_models.dart';
import 'device_link_controller.dart';

/// 받다 만 파일(이어받기용). 키 = 일련번호·세션 번호·최종 해시 앞부분 → 단말 기록이 바뀌면 키도 달라 새로 받는다
abstract interface class PartialDownloadStore {
  Future<Uint8List> read(String key);
  Future<void> append(String key, Uint8List bytes);
  Future<void> clear(String key);
}

class FilePartialDownloadStore implements PartialDownloadStore {
  FilePartialDownloadStore(this.dir);
  final Directory dir;

  File _file(String key) => File('${dir.path}/${key.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_')}.pel.part');

  @override
  Future<Uint8List> read(String key) async {
    final file = _file(key);
    return await file.exists() ? await file.readAsBytes() : Uint8List(0);
  }

  @override
  Future<void> append(String key, Uint8List bytes) async {
    await dir.create(recursive: true);
    await _file(key).writeAsBytes(bytes, mode: FileMode.append, flush: true);
  }

  @override
  Future<void> clear(String key) async {
    final file = _file(key);
    if (await file.exists()) await file.delete();
  }
}

class MemoryPartialDownloadStore implements PartialDownloadStore {
  final files = <String, Uint8List>{};
  @override
  Future<Uint8List> read(String key) async => files[key] ?? Uint8List(0);
  @override
  Future<void> append(String key, Uint8List bytes) async => files[key] = Uint8List.fromList([...?files[key], ...bytes]);
  @override
  Future<void> clear(String key) async => files.remove(key);
}

enum LogSyncPhase { idle, listing, downloading, verifying, uploading, done, failed }

// 화면 문구
const logSyncDisconnectedMessage = '단말과의 연결이 끊겼습니다. 재연결 시 이어서 다운로드합니다.';
const logSyncUploadPendingMessage = '기기 로컬 백업은 완료되었으나 서버 통신이 원활하지 않습니다. 네트워크 연결 후 자동으로 업로드됩니다.';
const logSyncDoneMessage = '백업 완료: SHA-256 무결성 검증을 통과하여 서버에 안전하게 등록되었습니다.';

String tamperedMessage(int? brokenSequenceId) =>
    '데이터 위·변조가 감지되었거나 파일이 손상되었습니다.${brokenSequenceId == null ? '' : ' (패킷 #$brokenSequenceId 해시 불일치)'} 단말 원본은 지우지 않고 보존합니다.';

class DeviceLogSync extends ChangeNotifier {
  DeviceLogSync({
    required this._link,
    required this._events,
    required this._partials,
    this.chunkTimeout = const Duration(seconds: 2),
  });

  final DeviceLinkController _link;
  final EventSyncController _events;
  final PartialDownloadStore _partials;
  final Duration chunkTimeout;

  LogSyncPhase _phase = LogSyncPhase.idle;
  String? _message;
  int receivedBytes = 0;
  int totalBytes = 0;
  int pendingSessions = 0;
  int? currentSession;
  bool lastSessionTampered = false;
  Future<void>? _running;
  bool _rerun = false;
  bool _attached = false;
  bool _disposed = false;

  LogSyncPhase get phase => _phase;
  String? get message => _message;
  bool get busy => _running != null;

  /// 연결되면 자동으로 동기화하고, 업로드가 끝나면(서버 응답) 보관 완료 확인을 보낸다
  void attach() {
    if (_attached) return;
    _attached = true;
    _link.addListener(_onChange);
    _events.addListener(_onChange);
  }

  void _onChange() {
    if (!_disposed && _link.isConnected) unawaited(syncNow());
  }

  @override
  void notifyListeners() {
    if (!_disposed) super.notifyListeners();
  }

  /// 동기화(실행 중이면 끝난 뒤 한 번 더)
  Future<void> syncNow() {
    if (_running != null) {
      _rerun = true;
      return _running!;
    }
    final run = _run().whenComplete(() => _running = null);
    _running = run;
    return run.then((_) {
      if (_rerun && !_disposed && _link.isConnected) {
        _rerun = false;
        return syncNow();
      }
      _rerun = false;
    });
  }

  void _set(LogSyncPhase phase, [String? message]) {
    _phase = phase;
    _message = message;
    notifyListeners();
  }

  Future<void> _run() async {
    final link = _link.activeLink;
    final device = _link.device;
    if (link == null || device == null) return;
    _ChunkInbox? inbox;
    try {
      inbox = _ChunkInbox(await link.subscribe(BleUuids.forensicService, BleUuids.sessionDataChunk));
      // 목록 조회는 화면 상태를 바꾸지 않는다(직전 '백업 완료' 안내를 지우지 않도록)
      final entries = (await _list(link, inbox)).where((e) => !e.archivedConfirmed).toList();
      pendingSessions = entries.length;
      if (entries.isEmpty) {
        if (_message == logSyncDisconnectedMessage) _set(LogSyncPhase.idle);
        return;
      }
      for (final entry in entries) {
        await _handle(link, inbox, device, entry);
        pendingSessions -= 1;
      }
      if (_phase != LogSyncPhase.failed) _set(_phase == LogSyncPhase.uploading ? LogSyncPhase.uploading : LogSyncPhase.done, _message);
    } on BleException {
      _set(LogSyncPhase.failed, logSyncDisconnectedMessage);
    } on TimeoutException {
      _set(LogSyncPhase.failed, logSyncDisconnectedMessage);
    } finally {
      await inbox?.close();
    }
  }

  Future<List<SessionIndexEntry>> _list(BleLink link, _ChunkInbox inbox) async {
    inbox.clear();
    await link.write(BleUuids.forensicService, BleUuids.sessionControl, encodeSessionControl(SessionCommand.list));
    final entries = <SessionIndexEntry>[];
    for (var quiet = 0; quiet < 10;) {
      final bytes = await inbox.next(const Duration(milliseconds: 300));
      if (bytes == null) {
        final status = TransferStatus.decode(await link.read(BleUuids.forensicService, BleUuids.transferStatus));
        if (status.state == TransferState.complete && inbox.isEmpty) break;
        quiet += 1;
        continue;
      }
      try {
        entries.add(SessionIndexEntry.decode(DataChunk.decode(bytes).payload));
      } on BleFormatException {
        // 깨진 항목은 다음 동기화에서 다시 받는다
      }
    }
    return entries;
  }

  LocalEventBackup? _localCopy(DriverDevice device, SessionIndexEntry entry) => _events.backups
      .where((b) => b.seal?.serial == device.serialNumber && b.seal?.sessionIndex == entry.sessionId && b.seal?.finalHashHex == toHex(entry.finalHash))
      .firstOrNull;

  Future<void> _handle(BleLink link, _ChunkInbox inbox, DriverDevice device, SessionIndexEntry entry) async {
    currentSession = entry.sessionId;
    final existing = _localCopy(device, entry);
    if (existing != null) {
      // 이미 받아 둔 기록: 서버 검증까지 끝났을 때만 단말에 보관 완료를 알린다
      if (existing.status == UploadStatus.completed && existing.integrityVerified == true) {
        await link.write(BleUuids.forensicService, BleUuids.sessionControl, encodeSessionControl(SessionCommand.confirmArchived, sessionId: entry.sessionId));
        _set(LogSyncPhase.done, logSyncDoneMessage);
      } else if (existing.status == UploadStatus.completed) {
        // 서버가 검증 실패로 판정한 기록: 단말 원본을 그대로 보존(보관 완료를 보내지 않음)
        if (_phase != LogSyncPhase.failed) _set(LogSyncPhase.failed, tamperedMessage(null));
      } else {
        _set(LogSyncPhase.uploading, logSyncUploadPendingMessage);
      }
      return;
    }

    final key = '${device.serialNumber}-${entry.sessionId}-${toHex(entry.finalHash).substring(0, 16)}';
    var bytes = await _download(link, inbox, entry, key);
    // 전송 오류(CRC-32 불일치)는 처음부터 한 번 더 받는다
    if (!await _crcMatches(link, bytes)) {
      await _partials.clear(key);
      bytes = await _download(link, inbox, entry, key);
      if (!await _crcMatches(link, bytes)) {
        await _partials.clear(key);
        _set(LogSyncPhase.failed, '전송 데이터가 계속 손상됩니다(CRC-32 불일치). 단말과 가까이에서 다시 시도해 주세요.');
        return;
      }
    }

    _set(LogSyncPhase.verifying, '데이터 무결성 검증 중...');
    final first = decodePacketRecord(bytes, 0);
    final chain = verifyBinaryHashChain(bytes, expectedInitialHash: toHex(deviceGenesisHash(device.serialNumber, first.timestampMs)));
    final key32 = device.authPublicKey;
    final sealOk = key32 != null && await entry.verifySeal(device.serialNumber, key32);
    final finalOk = chain.finalHash == toHex(entry.finalHash);
    lastSessionTampered = !chain.isValid || !finalOk || !sealOk;

    // 검증 결과와 관계없이 증거는 보존한다(판정은 서버가 다시 함). 변조·손상 기록은 단말에 보관 완료를 보내지 않는다
    final last = decodePacketRecord(bytes, (packetCountOf(bytes) - 1) * packetSize);
    final outcome = await _events.backup(
      device.deviceId,
      FrozenSession(
        triggerType: TriggerType.fromDb(entry.trigger) ?? TriggerType.shock,
        triggerAtMs: first.timestampMs,
        startTimeMs: first.timestampMs,
        endTimeMs: last.timestampMs,
        recordCount: packetCountOf(bytes),
        bytes: bytes,
        seal: DeviceSeal(
          serial: device.serialNumber,
          sessionIndex: entry.sessionId,
          signatureBase64: base64Encode(entry.sealSignature),
          finalHashHex: toHex(entry.finalHash),
        ),
      ),
    );
    await _partials.clear(key);

    final saved = _localCopy(device, entry);
    if (outcome == BackupOutcome.uploaded && saved?.integrityVerified == true) {
      await link.write(BleUuids.forensicService, BleUuids.sessionControl, encodeSessionControl(SessionCommand.confirmArchived, sessionId: entry.sessionId));
      _set(LogSyncPhase.done, logSyncDoneMessage);
    } else if (outcome == BackupOutcome.uploaded) {
      _set(LogSyncPhase.failed, tamperedMessage(chain.brokenSequenceId));
    } else {
      _set(LogSyncPhase.uploading, logSyncUploadPendingMessage);
    }
  }

  Future<bool> _crcMatches(BleLink link, Uint8List bytes) async {
    final status = TransferStatus.decode(await link.read(BleUuids.forensicService, BleUuids.transferStatus));
    return status.state == TransferState.complete && status.totalBytes == bytes.length && status.crc32 == crc32(bytes);
  }

  /// 오프셋부터 이어받는다. 받은 청크는 바로 기기에 덧붙여 저장(언제 끊겨도 이어받기 가능)
  Future<Uint8List> _download(BleLink link, _ChunkInbox inbox, SessionIndexEntry entry, String key) async {
    final buffer = BytesBuilder(copy: false)..add(await _partials.read(key));
    if (buffer.length >= entry.byteLength) {
      // 저장이 끝난 뒤 백업 전에 끊긴 경우: 파일이 완성돼 있다
      return buffer.toBytes().sublist(0, entry.byteLength);
    }
    totalBytes = entry.byteLength;
    receivedBytes = buffer.length;
    _set(LogSyncPhase.downloading, null);

    Future<void> start() async {
      inbox.clear();
      await link.write(BleUuids.forensicService, BleUuids.sessionControl, encodeSessionControl(SessionCommand.start, sessionId: entry.sessionId, offset: buffer.length));
    }

    Future<void> send(Uint8List data) => link.write(BleUuids.forensicService, BleUuids.transferStatus, data);

    await start();
    var expected = 0;
    var sinceAck = 0;
    var timeouts = 0;
    var nackedAt = -1;
    while (buffer.length < entry.byteLength) {
      final raw = await inbox.next(chunkTimeout);
      if (raw == null) {
        timeouts += 1;
        if (timeouts >= 3) {
          timeouts = 0;
          expected = 0;
          nackedAt = -1;
          await start();
        } else {
          await send(encodeNack(expected));
        }
        continue;
      }
      timeouts = 0;
      final DataChunk chunk;
      try {
        chunk = DataChunk.decode(raw);
      } on BleFormatException {
        if (nackedAt != expected) {
          nackedAt = expected;
          await send(encodeNack(expected));
        }
        continue;
      }
      if (chunk.seq != expected) {
        // 빠진 청크 다음 것이 왔다 → 빠진 번호부터 다시(한 번만 요청), 이미 받은 것은 버린다
        if (chunk.seq > expected && nackedAt != expected) {
          nackedAt = expected;
          await send(encodeNack(expected));
        }
        continue;
      }
      final room = entry.byteLength - buffer.length;
      final payload = chunk.payload.length > room ? Uint8List.sublistView(chunk.payload, 0, room) : chunk.payload;
      buffer.add(payload);
      await _partials.append(key, payload);
      expected += 1;
      nackedAt = -1;
      sinceAck += 1;
      receivedBytes = buffer.length;
      if (sinceAck >= 4 || buffer.length >= entry.byteLength) {
        sinceAck = 0;
        await send(encodeAck(expected - 1));
      }
      notifyListeners();
    }
    return buffer.toBytes();
  }

  @override
  void dispose() {
    _disposed = true;
    if (_attached) {
      _link.removeListener(_onChange);
      _events.removeListener(_onChange);
    }
    super.dispose();
  }
}

/// 알림으로 오는 청크를 쌓아 두고, 기다려 꺼낸다(시간 초과 시 null)
class _ChunkInbox {
  _ChunkInbox(Stream<Uint8List> stream) {
    _subscription = stream.listen((bytes) {
      final waiter = _waiter;
      if (waiter != null && !waiter.isCompleted) {
        _waiter = null;
        waiter.complete(bytes);
      } else {
        _queue.add(bytes);
      }
    }, onDone: () => _waiter?.completeError(const BleException('연결이 끊겼습니다.')), onError: (_) {});
  }

  late final StreamSubscription<Uint8List> _subscription;
  final _queue = Queue<Uint8List>();
  Completer<Uint8List?>? _waiter;

  bool get isEmpty => _queue.isEmpty;
  void clear() => _queue.clear();

  Future<Uint8List?> next(Duration timeout) {
    if (_queue.isNotEmpty) return Future.value(_queue.removeFirst());
    final waiter = Completer<Uint8List?>();
    _waiter = waiter;
    return waiter.future.timeout(timeout, onTimeout: () {
      if (identical(_waiter, waiter)) _waiter = null;
      return null;
    });
  }

  Future<void> close() => _subscription.cancel();
}
