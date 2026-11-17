import 'dart:convert';

/// 빌드 시 `--dart-define-from-file=.env` 로 넣는 공개 접속 정보.
/// 서버 비밀 키는 받지 않는다. 앱 번들은 누구나 풀어 볼 수 있기 때문이다.
class AppConfig {
  const AppConfig({required this.supabaseUrl, required this.supabaseAnonKey, required this.webApiBaseUrl});

  final String supabaseUrl;
  final String supabaseAnonKey;
  final Uri webApiBaseUrl;

  static const _url = String.fromEnvironment('SUPABASE_URL');
  static const _anonKey = String.fromEnvironment('SUPABASE_ANON_KEY');
  static const _webApi = String.fromEnvironment('WEB_API_BASE_URL');

  /// 값이 비었거나 형식이 틀리면 [AppConfigException] 을 던진다.
  static AppConfig fromEnvironment() => parse(url: _url, anonKey: _anonKey, webApi: _webApi);

  static AppConfig parse({required String url, required String anonKey, required String webApi}) {
    // 웹 화면에서 복사할 때 딸려 오는 앞뒤 공백·보이지 않는 문자·따옴표를 정리한다
    url = clean(url);
    anonKey = clean(anonKey);
    webApi = clean(webApi);
    final missing = [
      if (url.isEmpty) 'SUPABASE_URL',
      if (anonKey.isEmpty) 'SUPABASE_ANON_KEY',
      if (webApi.isEmpty) 'WEB_API_BASE_URL',
    ];
    if (missing.isNotEmpty) throw AppConfigException('설정값이 비어 있습니다: ${missing.join(', ')}');
    if (!isPublicClientKey(anonKey)) {
      throw AppConfigException(
        'SUPABASE_ANON_KEY 에는 공개 키(sb_publishable_… 또는 anon JWT)만 넣을 수 있습니다. '
        '받은 값: ${describeKey(anonKey)}',
      );
    }
    final apiUri = Uri.tryParse(webApi.endsWith('/') ? webApi.substring(0, webApi.length - 1) : webApi);
    if (apiUri == null || !apiUri.hasScheme || apiUri.host.isEmpty) {
      throw const AppConfigException('WEB_API_BASE_URL 형식이 올바르지 않습니다.');
    }
    return AppConfig(supabaseUrl: url, supabaseAnonKey: anonKey, webApiBaseUrl: apiUri);
  }

  /// 앞뒤의 공백(줄바꿈 없는 공백 포함)·폭 없는 문자(BOM 등)·따옴표를 지운다
  static String clean(String value) {
    bool junk(int c) =>
        c <= 0x20 || // 공백·탭·줄바꿈
        c == 0x22 ||
        c == 0x27 ||
        c == 0x60 || // " ' `
        c == 0x00A0 ||
        (c >= 0x200B && c <= 0x200D) ||
        c == 0x2060 ||
        c == 0xFEFF;
    var start = 0;
    var end = value.length;
    while (start < end && junk(value.codeUnitAt(start))) {
      start++;
    }
    while (end > start && junk(value.codeUnitAt(end - 1))) {
      end--;
    }
    return value.substring(start, end);
  }

  /// 오류 안내용: 키 전체는 보이지 않고 앞 15자·길이·첫 글자 코드만
  static String describeKey(String key) {
    if (key.isEmpty) return '(비어 있음)';
    final head = key.length <= 15 ? key : key.substring(0, 15);
    return '앞 15자 "$head", 길이 ${key.length}, 첫 글자 코드 U+${key.codeUnitAt(0).toRadixString(16).toUpperCase().padLeft(4, '0')}';
  }

  /// 허용 목록 방식: 새 형식 공개 키(sb_publishable_) 또는 role 이 anon 인 JWT 만 통과시킨다.
  static bool isPublicClientKey(String key) {
    if (key.startsWith('sb_publishable_')) return true;
    final parts = key.split('.');
    if (parts.length != 3) return false;
    try {
      final payload = jsonDecode(utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))));
      return payload is Map<String, dynamic> && payload['role'] == 'anon';
    } on FormatException {
      return false;
    }
  }
}

class AppConfigException implements Exception {
  const AppConfigException(this.message);
  final String message;

  @override
  String toString() => message;
}
