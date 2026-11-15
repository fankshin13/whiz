import '../../../core/forensics/event_recorder.dart';

/// 기기에 백업된 세션의 업로드 상태
enum UploadStatus { pending, uploading, completed, failed }

/// 기기 안 백업 한 건(.pel 파일 + 이 메타데이터)
class LocalEventBackup {
  const LocalEventBackup({
    required this.localId,
    required this.deviceId,
    required this.triggerType,
    required this.startTimeMs,
    required this.endTimeMs,
    required this.recordCount,
    required this.status,
    required this.createdAtMs,
    this.serverSessionId,
    this.integrityVerified,
    this.errorMessage,
  });

  final String localId;
  final String deviceId;
  final TriggerType triggerType;
  final int startTimeMs;
  final int endTimeMs;
  final int recordCount;
  final UploadStatus status;
  final int createdAtMs;

  /// 서버가 정한 값만 담는다(앱이 판정하지 않음)
  final String? serverSessionId;
  final bool? integrityVerified;
  final String? errorMessage;

  LocalEventBackup copyWith({
    UploadStatus? status,
    String? serverSessionId,
    bool? integrityVerified,
    String? errorMessage,
    bool clearError = false,
  }) => LocalEventBackup(
    localId: localId,
    deviceId: deviceId,
    triggerType: triggerType,
    startTimeMs: startTimeMs,
    endTimeMs: endTimeMs,
    recordCount: recordCount,
    createdAtMs: createdAtMs,
    status: status ?? this.status,
    serverSessionId: serverSessionId ?? this.serverSessionId,
    integrityVerified: integrityVerified ?? this.integrityVerified,
    errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
  );

  Map<String, Object?> toJson() => {
    'localId': localId,
    'deviceId': deviceId,
    'triggerType': triggerType.dbValue,
    'startTimeMs': startTimeMs,
    'endTimeMs': endTimeMs,
    'recordCount': recordCount,
    'status': status.name,
    'createdAtMs': createdAtMs,
    'serverSessionId': serverSessionId,
    'integrityVerified': integrityVerified,
    'errorMessage': errorMessage,
  };

  /// 형식이 맞지 않으면 null(손상된 메타데이터는 목록에서 '손상'으로 따로 알린다)
  static LocalEventBackup? fromJson(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final trigger = TriggerType.fromDb(json['triggerType']);
    final status = UploadStatus.values.where((s) => s.name == json['status']).firstOrNull;
    final ints = [json['startTimeMs'], json['endTimeMs'], json['recordCount'], json['createdAtMs']];
    final localId = json['localId'];
    final deviceId = json['deviceId'];
    if (trigger == null || status == null || ints.any((v) => v is! int) || localId is! String || deviceId is! String) {
      return null;
    }
    final serverId = json['serverSessionId'];
    final verified = json['integrityVerified'];
    final error = json['errorMessage'];
    return LocalEventBackup(
      localId: localId,
      deviceId: deviceId,
      triggerType: trigger,
      startTimeMs: ints[0]! as int,
      endTimeMs: ints[1]! as int,
      recordCount: ints[2]! as int,
      createdAtMs: ints[3]! as int,
      status: status,
      serverSessionId: serverId is String ? serverId : null,
      integrityVerified: verified is bool ? verified : null,
      errorMessage: error is String ? error : null,
    );
  }
}

/// 서버에 저장된 세션(RLS: 운전자는 본인 배정 차량 세션만 보임)
class ServerEventSession {
  const ServerEventSession({
    required this.id,
    required this.deviceId,
    required this.triggerType,
    required this.startTime,
    required this.endTime,
    required this.recordCount,
    required this.integrityVerified,
    required this.plateNumber,
    this.initialHash,
    this.finalHash,
    this.rawLogPath,
  });

  final String id;
  final String deviceId;
  final TriggerType triggerType;
  final DateTime startTime;
  final DateTime endTime;
  final int recordCount;
  final bool integrityVerified;
  final String plateNumber;
  final String? initialHash;
  final String? finalHash;
  final String? rawLogPath;
}
