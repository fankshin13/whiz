import 'dart:async';
import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../domain/user_role.dart';

enum SignInFailure { invalidCredentials, deactivated, network, unknown }

class SignInException implements Exception {
  const SignInException(this.failure);
  final SignInFailure failure;
}

/// 역할을 조회하지 못했을 때(오프라인 등). 역할을 모르면 앱 기능을 열지 않는다.
class RoleLookupException implements Exception {
  const RoleLookupException();
}

/// 관리자가 비활성화한 계정. 세션이 남아 있어도 앱 기능을 열지 않고 로그아웃한다.
class AccountDeactivatedException implements Exception {
  const AccountDeactivatedException();
}

enum AccountDeletionFailure { wrongPassword, alreadyInactive, notAllowed, network, unknown }

/// 계정 삭제 요청 실패(비밀번호 확인 실패, 이미 비활성 등)
class AccountDeletionException implements Exception {
  const AccountDeletionException(this.failure);
  final AccountDeletionFailure failure;
}

/// 인증과 역할 조회. 화면·상태 관리 코드는 Supabase 를 직접 모르도록 이 인터페이스만 쓴다.
abstract interface class AuthRepository {
  String? get currentUserId;

  /// 로그인·로그아웃·세션 만료 때마다 현재 사용자 ID(없으면 null)를 흘려보낸다
  Stream<String?> userIdChanges();

  Future<void> signIn({required String email, required String password});

  Future<void> signOut();

  /// 본인 계정 삭제 요청: 비밀번호로 다시 확인한 뒤 서버가 즉시 비활성화하고, 이 기기에서 로그아웃한다.
  Future<void> requestAccountDeletion({required String password, String? reason});

  /// public.users 에서 본인 역할을 읽는다(RLS: 본인 행만 보임).
  /// 비활성화된 계정이면 [AccountDeactivatedException].
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
      // 비밀번호가 맞을 때만 오는 코드라 계정 존재 여부가 새지 않는다
      if (error.code == 'user_banned') throw const SignInException(SignInFailure.deactivated);
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
  Future<void> requestAccountDeletion({required String password, String? reason}) async {
    final email = _client.auth.currentUser?.email;
    if (email == null) throw const AccountDeletionException(AccountDeletionFailure.unknown);
    try {
      await _client.auth.signInWithPassword(email: email, password: password);
    } on AuthRetryableFetchException {
      throw const AccountDeletionException(AccountDeletionFailure.network);
    } on AuthApiException catch (error) {
      throw AccountDeletionException(
        error.code == 'user_banned' ? AccountDeletionFailure.alreadyInactive : AccountDeletionFailure.wrongPassword,
      );
    } on SocketException {
      throw const AccountDeletionException(AccountDeletionFailure.network);
    } on TimeoutException {
      throw const AccountDeletionException(AccountDeletionFailure.network);
    }
    try {
      final trimmed = reason?.trim();
      await _client.rpc<dynamic>('request_account_deletion', params: {'p_reason': (trimmed == null || trimmed.isEmpty) ? null : trimmed});
    } on PostgrestException catch (error) {
      throw AccountDeletionException(switch (error.message) {
        final m when m.contains('ALREADY_INACTIVE') => AccountDeletionFailure.alreadyInactive,
        final m when m.contains('SUPER_ADMIN_SELF') => AccountDeletionFailure.notAllowed,
        _ => AccountDeletionFailure.unknown,
      });
    } on SocketException {
      throw const AccountDeletionException(AccountDeletionFailure.network);
    }
    // 서버가 이미 모든 세션을 폐기했다. 이 기기의 세션 기억만 지운다
    await signOut();
  }

  @override
  Future<UserRole> fetchRole(String userId) async {
    try {
      final row = await _client.from('users').select('role, is_active').eq('id', userId).maybeSingle();
      if (row?['is_active'] == false) throw const AccountDeactivatedException();
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
