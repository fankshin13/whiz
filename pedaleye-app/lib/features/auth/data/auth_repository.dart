import 'dart:async';
import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../domain/user_role.dart';

enum SignInFailure { invalidCredentials, network, unknown }

class SignInException implements Exception {
  const SignInException(this.failure);
  final SignInFailure failure;
}

/// 역할을 조회하지 못했을 때(오프라인 등). 역할을 모르면 앱 기능을 열지 않는다.
class RoleLookupException implements Exception {
  const RoleLookupException();
}

/// 인증과 역할 조회. 화면·상태 관리 코드는 Supabase 를 직접 모르도록 이 인터페이스만 쓴다.
abstract interface class AuthRepository {
  String? get currentUserId;

  /// 로그인·로그아웃·세션 만료 때마다 현재 사용자 ID(없으면 null)를 흘려보낸다
  Stream<String?> userIdChanges();

  Future<void> signIn({required String email, required String password});

  Future<void> signOut();

  /// public.users 에서 본인 역할을 읽는다(RLS: 본인 행만 보임)
  Future<UserRole> fetchRole(String userId);
}

class SupabaseAuthRepository implements AuthRepository {
  SupabaseAuthRepository(this._client);
  final SupabaseClient _client;

  @override
  String? get currentUserId => _client.auth.currentSession?.user.id;

  @override
  Stream<String?> userIdChanges() => _client.auth.onAuthStateChange.map((state) => state.session?.user.id).distinct();

  @override
  Future<void> signIn({required String email, required String password}) async {
    try {
      await _client.auth.signInWithPassword(email: email.trim(), password: password);
    } on AuthRetryableFetchException {
      throw const SignInException(SignInFailure.network);
    } on AuthApiException catch (error) {
      if (error.code == 'invalid_credentials' || error.statusCode == '400') {
        throw const SignInException(SignInFailure.invalidCredentials);
      }
      throw const SignInException(SignInFailure.unknown);
    } on SocketException {
      throw const SignInException(SignInFailure.network);
    } on TimeoutException {
      throw const SignInException(SignInFailure.network);
    }
  }

  @override
  Future<void> signOut() => _client.auth.signOut(scope: SignOutScope.local);

  @override
  Future<UserRole> fetchRole(String userId) async {
    try {
      final row = await _client.from('users').select('role').eq('id', userId).maybeSingle();
      final role = UserRole.fromDb(row?['role']);
      if (role == null) throw const RoleLookupException();
      return role;
    } on PostgrestException {
      throw const RoleLookupException();
    } on SocketException {
      throw const RoleLookupException();
    } on AuthException {
      throw const RoleLookupException();
    }
  }
}
