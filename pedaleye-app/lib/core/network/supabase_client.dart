import 'package:supabase_flutter/supabase_flutter.dart';

import '../config/app_config.dart';
import 'secure_session_storage.dart';

/// 앱 시작 시 한 번 호출한다. 저장된 세션이 있으면 여기서 복원된다.
Future<SupabaseClient> initializeSupabase(AppConfig config) async {
  await Supabase.initialize(
    url: config.supabaseUrl,
    publishableKey: config.supabaseAnonKey,
    authOptions: FlutterAuthClientOptions(
      localStorage: SecureSessionStorage(),
      // 인증 메일 링크 로그인을 쓰지 않으므로 딥링크에서 세션을 찾지 않는다(초대 딥링크와 섞이지 않게)
      detectSessionInUri: false,
    ),
  );
  return Supabase.instance.client;
}
