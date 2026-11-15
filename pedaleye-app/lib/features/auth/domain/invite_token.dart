/// 관리자가 보낸 초대 링크 전체 또는 토큰(hex 64자)만 붙여 넣어도 토큰을 꺼낸다.
/// 형식 검사만 한다. 실제 유효성(만료·사용 여부)은 서버가 판단한다.
abstract final class InviteToken {
  static final _pattern = RegExp(r'^[0-9a-f]{64}$');

  static String? parse(String input) {
    final text = input.trim();
    if (text.isEmpty) return null;
    final candidate = text.contains('token=') ? Uri.tryParse(text)?.queryParameters['token'] ?? '' : text;
    final token = candidate.trim().toLowerCase();
    return _pattern.hasMatch(token) ? token : null;
  }
}
