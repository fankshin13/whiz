import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import '../../../core/forensics/event_recorder.dart';
import '../domain/event_models.dart';

/// 기기 안 사고 기록 백업 저장소
abstract interface class EventBackupStore {
  Future<LocalEventBackup> save(String userId, String deviceId, FrozenSession session);
  Future<void> update(String userId, LocalEventBackup backup);

  /// 최신순
  Future<List<LocalEventBackup>> list(String userId);
  Future<Uint8List> readBytes(String userId, String localId);
}

/// 기기 안 사고 기록 백업. 사용자별 폴더에 `{localId}.pel`(원본)과 `{localId}.json`(상태)을 둔다.
/// 앱 전용 저장소(App Documents)라 다른 앱이 읽을 수 없고, 네트워크와 무관하게 보존된다.
class LocalEventStore implements EventBackupStore {
  LocalEventStore(this._root);

  /// 예: {documents}/events
  final Directory _root;
  final _random = Random.secure();

  Directory _dirFor(String userId) => Directory('${_root.path}/$userId');

  File _pel(String userId, String localId) => File('${_dirFor(userId).path}/$localId.pel');
  File _meta(String userId, String localId) => File('${_dirFor(userId).path}/$localId.json');

  /// 원본을 먼저 쓰고 메타데이터를 마지막에 쓴다(메타가 있으면 원본도 반드시 있다)
  @override
  Future<LocalEventBackup> save(String userId, String deviceId, FrozenSession session) async {
    final dir = _dirFor(userId);
    await dir.create(recursive: true);
    final localId = '${session.startTimeMs}-${_random.nextInt(1 << 32).toRadixString(16)}';
    await _writeAtomic(_pel(userId, localId), session.bytes);
    final backup = LocalEventBackup(
      localId: localId,
      deviceId: deviceId,
      triggerType: session.triggerType,
      startTimeMs: session.startTimeMs,
      endTimeMs: session.endTimeMs,
      recordCount: session.recordCount,
      status: UploadStatus.pending,
      createdAtMs: DateTime.now().millisecondsSinceEpoch,
      seal: session.seal,
    );
    await update(userId, backup);
    return backup;
  }

  @override
  Future<void> update(String userId, LocalEventBackup backup) =>
      _writeAtomic(_meta(userId, backup.localId), utf8.encode(jsonEncode(backup.toJson())));

  @override
  Future<List<LocalEventBackup>> list(String userId) async {
    final dir = _dirFor(userId);
    if (!await dir.exists()) return [];
    final items = <LocalEventBackup>[];
    await for (final entity in dir.list()) {
      if (entity is! File || !entity.path.endsWith('.json')) continue;
      final backup = LocalEventBackup.fromJson(jsonDecode(await entity.readAsString()));
      if (backup != null) items.add(backup);
    }
    items.sort((a, b) => b.startTimeMs.compareTo(a.startTimeMs));
    return items;
  }

  @override
  Future<Uint8List> readBytes(String userId, String localId) => _pel(userId, localId).readAsBytes();

  Future<void> _writeAtomic(File file, List<int> bytes) async {
    final temp = File('${file.path}.tmp');
    await temp.writeAsBytes(bytes, flush: true);
    await temp.rename(file.path);
  }
}
