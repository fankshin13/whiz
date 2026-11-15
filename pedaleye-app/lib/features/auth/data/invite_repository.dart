import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import '../domain/invitation.dart';

/// 웹 콘솔의 공개 초대 API 를 부른다. 앱은 서버 비밀 키 없이 토큰만 보낸다.
class InviteRepository {
  InviteRepository({required this.baseUrl, http.Client? client}) : _client = client ?? http.Client();

  final Uri baseUrl;
  final http.Client _client;
  static const _timeout = Duration(seconds: 15);

  Future<InvitationCheck> verify(String token) async {
    final (status, body) = await _post('/api/invitations/verify', {'token': token});
    if (status == 429) throw const InviteRateLimitedException();
    if (status != 200) throw const InviteNetworkException();
    if (body['isValid'] == true) {
      final email = body['email'];
      final inviteeName = body['inviteeName'];
      final orgName = body['orgName'];
      final plate = body['vehiclePlate'];
      if (email is! String || inviteeName is! String || orgName is! String || (plate != null && plate is! String)) {
        throw const InviteNetworkException();
      }
      return ValidInvitation(email: email, inviteeName: inviteeName, orgName: orgName, vehiclePlate: plate as String?);
    }
    final reason = body['reason'];
    return UnusableInvitation(reason is String ? reason : 'NOT_FOUND');
  }

  /// 성공하면 가입된 이메일을 돌려준다. 로그인은 호출한 쪽이 이 이메일과 비밀번호로 한다.
  Future<String> accept({required String token, required String password}) async {
    final (status, body) = await _post('/api/invitations/accept', {'token': token, 'password': password});
    if (status == 200 && body['success'] == true && body['email'] is String) return body['email'] as String;
    if (status == 429) throw const AcceptInviteException(AcceptFailure.rateLimited);
    if (status == 400 || status == 500) {
      final message = body['message'];
      throw AcceptInviteException(AcceptFailure.fromCode(body['error']), message is String ? message : null);
    }
    throw const InviteNetworkException();
  }

  Future<(int, Map<String, dynamic>)> _post(String path, Map<String, String> payload) async {
    try {
      final response = await _client
          .post(
            baseUrl.replace(path: '${baseUrl.path}$path'),
            headers: {'content-type': 'application/json'},
            body: jsonEncode(payload),
          )
          .timeout(_timeout);
      final decoded = response.body.isEmpty ? null : jsonDecode(response.body);
      return (response.statusCode, decoded is Map<String, dynamic> ? decoded : const <String, dynamic>{});
    } on SocketException {
      throw const InviteNetworkException();
    } on TimeoutException {
      throw const InviteNetworkException();
    } on http.ClientException {
      throw const InviteNetworkException();
    } on FormatException {
      throw const InviteNetworkException();
    }
  }
}
