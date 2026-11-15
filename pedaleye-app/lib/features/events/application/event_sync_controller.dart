import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../core/forensics/event_recorder.dart';
import '../data/event_uploader.dart';
import '../data/local_event_store.dart';
import '../domain/event_models.dart';

/// 네트워크 연결 상태. 실제 서버 도달 여부는 업로드 시도로 판단하고, 이 값은 '언제 다시 시도할지'에만 쓴다.
abstract interface class Connectivity {
  Future<bool> isOnline();
  Stream<bool> get onlineChanges;
}

enum BackupOutcome {
  /// 기기에 저장했고 서버 업로드도 끝남
  uploaded,

  /// 기기에 저장했고 오프라인이라 나중에 올림
  savedOffline,

  /// 기기에 저장했지만 업로드가 실패(재시도 가능)
  savedUploadFailed,
}

/// 기기 백업 목록과 업로드 큐. 연결이 돌아오면 대기·실패 건을 자동으로 다시 올린다.
class EventSyncController extends ChangeNotifier {
  EventSyncController({required this.store, required this.uploader, required this.connectivity});

  final EventBackupStore store;
  final EventUploader uploader;
  final Connectivity connectivity;

  String? _userId;
  List<LocalEventBackup> _backups = const [];
  StreamSubscription<bool>? _online;
  Future<void>? _syncing;

  List<LocalEventBackup> get backups => _backups;

  /// 로그인한 운전자의 백업을 읽고, 연결 변화에 맞춰 자동 업로드를 시작한다
  Future<void> bind(String userId) async {
    if (_userId == userId) return;
    _userId = userId;
    await _online?.cancel();
    _online = connectivity.onlineChanges.where((online) => online).listen((_) => unawaited(syncPending()));
    await _reload();
    unawaited(syncPending());
  }

  Future<void> unbind() async {
    await _online?.cancel();
    _online = null;
    _userId = null;
    _backups = const [];
    notifyListeners();
  }

  /// 사고 세션을 기기에 먼저 저장하고(네트워크와 무관), 가능하면 바로 업로드한다
  Future<BackupOutcome> backup(String deviceId, FrozenSession session) async {
    final userId = _requireUser();
    final saved = await store.save(userId, deviceId, session);
    await _reload();
    if (!await connectivity.isOnline()) return BackupOutcome.savedOffline;
    final result = await _upload(userId, saved);
    return result?.status == UploadStatus.completed ? BackupOutcome.uploaded : BackupOutcome.savedUploadFailed;
  }

  /// 대기·재시도 가능 실패 건을 차례로 올린다(동시에 한 번만 실행)
  Future<void> syncPending() => _syncing ??= _syncAll().whenComplete(() => _syncing = null);

  /// 상세 화면의 '지금 업로드'
  Future<LocalEventBackup?> uploadNow(String localId) async {
    final userId = _requireUser();
    final backup = _backups.where((b) => b.localId == localId).firstOrNull;
    if (backup == null || backup.status == UploadStatus.completed) return backup;
    return _upload(userId, backup);
  }

  Future<void> _syncAll() async {
    final userId = _userId;
    if (userId == null || !await connectivity.isOnline()) return;
    for (final backup in List.of(_backups)) {
      final retryable =
          backup.status == UploadStatus.pending ||
          backup.status == UploadStatus.uploading || // 앱이 업로드 중에 꺼졌던 건
          (backup.status == UploadStatus.failed && backup.errorMessage == null);
      if (!retryable) continue;
      final result = await _upload(userId, backup);
      // 네트워크가 끊기면 남은 건은 다음 연결 때
      if (result?.status == UploadStatus.pending) break;
    }
  }

  Future<LocalEventBackup?> _upload(String userId, LocalEventBackup backup) async {
    await _put(userId, backup.copyWith(status: UploadStatus.uploading, clearError: true));
    try {
      final bytes = await store.readBytes(userId, backup.localId);
      final outcome = await uploader.upload(backup, bytes);
      return await _put(
        userId,
        backup.copyWith(
          status: UploadStatus.completed,
          serverSessionId: outcome.sessionId,
          integrityVerified: outcome.integrityVerified,
          clearError: true,
        ),
      );
    } on UploadException catch (error) {
      // 네트워크 문제는 대기로 되돌려 자동 재시도, 서버가 거절한 건은 이유를 남기고 멈춘다
      if (error.failure == UploadFailure.network) return _put(userId, backup.copyWith(status: UploadStatus.pending));
      return _put(
        userId,
        backup.copyWith(
          status: UploadStatus.failed,
          errorMessage: error.retryable ? null : (error.message ?? _failureText(error.failure)),
        ),
      );
    }
  }

  static String _failureText(UploadFailure failure) => switch (failure) {
    UploadFailure.unauthorized => '로그인이 만료되었습니다. 다시 로그인한 뒤 업로드해 주세요.',
    UploadFailure.rejected => '서버가 이 기록을 받지 않았습니다.',
    _ => '업로드에 실패했습니다.',
  };

  Future<LocalEventBackup> _put(String userId, LocalEventBackup backup) async {
    await store.update(userId, backup);
    if (_userId == userId) {
      _backups = [for (final b in _backups) b.localId == backup.localId ? backup : b];
      notifyListeners();
    }
    return backup;
  }

  Future<void> _reload() async {
    final userId = _userId;
    if (userId == null) return;
    _backups = await store.list(userId);
    notifyListeners();
  }

  String _requireUser() {
    final userId = _userId;
    if (userId == null) throw StateError('로그인한 운전자가 없습니다.');
    return userId;
  }

  @override
  void dispose() {
    unawaited(_online?.cancel());
    super.dispose();
  }
}
