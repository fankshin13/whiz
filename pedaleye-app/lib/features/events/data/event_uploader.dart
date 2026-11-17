import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../domain/event_models.dart';

class UploadOutcome {
  const UploadOutcome({required this.sessionId, required this.integrityVerified, required this.duplicate});

  final String sessionId;

  /// 서버가 해시 체인을 전수 검증한 결과
  final bool integrityVerified;

  /// 이미 올라간 같은 세션이었음(새로 만들지 않음)
  final bool duplicate;
}

enum UploadFailure {
  /// 오프라인·시간 초과 → 나중에 자동 재시도
  network,

  /// 로그인 만료
  unauthorized,

  /// 본인 단말이 아님 등. 다시 보내도 같은 결과
  rejected,

  /// 서버 일시 오류 → 재시도 가능
  server,
}

class UploadException implements Exception {
  const UploadException(this.failure, [this.message]);
  final UploadFailure failure;
  final String? message;

  bool get retryable => failure == UploadFailure.network || failure == UploadFailure.server;
}

abstract interface class EventUploader {
  Future<UploadOutcome> upload(LocalEventBackup backup, Uint8List pel);
}

/// 웹 콘솔 POST /api/events/upload. 원본(.pel)만 보내고 무결성 판정은 서버가 한다.
class HttpEventUploader implements EventUploader {
  HttpEventUploader({required this.baseUrl, required this.accessToken, http.Client? client})
    : _client = client ?? http.Client();

  final Uri baseUrl;

  /// 현재 로그인 세션의 액세스 토큰(없으면 null)
  final Future<String?> Function() accessToken;
  final http.Client _client;

  @override
  Future<UploadOutcome> upload(LocalEventBackup backup, Uint8List pel) async {
    final token = await accessToken();
    if (token == null) throw const UploadException(UploadFailure.unauthorized);
    final http.Response response;
    try {
      response = await _client
          .post(
            baseUrl.replace(path: '${baseUrl.path}/api/events/upload'),
            headers: {'content-type': 'application/json', 'authorization': 'Bearer $token'},
            body: jsonEncode({
              'deviceId': backup.deviceId,
              'triggerType': backup.triggerType.dbValue,
              'startTime': DateTime.fromMillisecondsSinceEpoch(backup.startTimeMs, isUtc: true).toIso8601String(),
              'endTime': DateTime.fromMillisecondsSinceEpoch(backup.endTimeMs, isUtc: true).toIso8601String(),
              'rawLogBase64': base64Encode(pel),
              // 단말이 봉인한 기록: 서버가 일련번호 체인과 봉인 서명을 확인한다
              if (backup.seal case final seal?) ...{'deviceSessionIndex': seal.sessionIndex, 'sealSignature': seal.signatureBase64},
            }),
          )
          .timeout(const Duration(seconds: 30));
    } on SocketException {
      throw const UploadException(UploadFailure.network);
    } on TimeoutException {
      throw const UploadException(UploadFailure.network);
    } on http.ClientException {
      throw const UploadException(UploadFailure.network);
    }

    final Object? decoded;
    try {
      decoded = response.bodyBytes.isEmpty ? null : jsonDecode(utf8.decode(response.bodyBytes));
    } on FormatException {
      throw const UploadException(UploadFailure.server);
    }
    final body = decoded is Map<String, dynamic> ? decoded : const <String, dynamic>{};
    final message = body['error'] is String ? body['error'] as String : null;

    if (response.statusCode == 200 && body['success'] == true) {
      final id = body['sessionId'];
      final verified = body['integrityVerified'];
      if (id is! String || verified is! bool) throw const UploadException(UploadFailure.server);
      return UploadOutcome(sessionId: id, integrityVerified: verified, duplicate: body['duplicate'] == true);
    }
    throw UploadException(switch (response.statusCode) {
      401 => UploadFailure.unauthorized,
      400 || 403 || 413 => UploadFailure.rejected,
      _ => UploadFailure.server,
    }, message);
  }
}
