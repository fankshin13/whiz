/// POST /api/invitations/verify 결과
sealed class InvitationCheck {
  const InvitationCheck();
}

class ValidInvitation extends InvitationCheck {
  const ValidInvitation({required this.email, required this.inviteeName, required this.orgName, this.vehiclePlate});

  final String email;
  final String inviteeName;
  final String orgName;
  final String? vehiclePlate;
}

/// 없음·만료·이미 사용·관리자 취소. 취소만 따로 안내한다.
class UnusableInvitation extends InvitationCheck {
  const UnusableInvitation(this.reason);
  final String reason;

  bool get revoked => reason == 'REVOKED';
}

/// POST /api/invitations/accept 실패 사유. 웹 서버의 reason 코드와 같다.
enum AcceptFailure {
  notFound,
  alreadyUsed,
  expired,
  revoked,
  emailExists,
  vehicleUnavailable,
  invalidInput,
  rateLimited,
  failed;

  static AcceptFailure fromCode(Object? code) => switch (code) {
    'NOT_FOUND' => notFound,
    'ALREADY_USED' => alreadyUsed,
    'EXPIRED' => expired,
    'REVOKED' => revoked,
    'EMAIL_EXISTS' => emailExists,
    'VEHICLE_UNAVAILABLE' => vehicleUnavailable,
    'INVALID_INPUT' => invalidInput,
    'RATE_LIMITED' => rateLimited,
    _ => failed,
  };

  /// 초대 자체를 더 쓸 수 없는 경우(재발급 필요)
  bool get invitationUnusable => this == notFound || this == alreadyUsed || this == expired || this == revoked;
}

class AcceptInviteException implements Exception {
  const AcceptInviteException(this.failure, [this.serverMessage]);
  final AcceptFailure failure;
  final String? serverMessage;
}

/// 서버에 닿지 못했거나(오프라인·시간 초과) 응답을 해석할 수 없을 때
class InviteNetworkException implements Exception {
  const InviteNetworkException();
}

class InviteRateLimitedException implements Exception {
  const InviteRateLimitedException();
}
