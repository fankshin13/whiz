import 'dart:async';

import 'package:flutter/foundation.dart';

import '../data/auth_repository.dart';

enum SessionStatus {
  /// 저장된 세션 복원·역할 확인 중
  checking,
  signedOut,
  driver,

  /// 로그인은 됐지만 운전자가 아님 → 웹 콘솔 안내
  notDriver,

  /// 역할을 확인하지 못함(네트워크 등) → 다시 시도 안내
  roleCheckFailed,
}

/// 세션 상태의 단일 출처. 라우터가 이 값으로 화면을 나눈다.
/// 로그인 직후에도 항상 public.users 의 역할을 조회해 운전자만 통과시킨다.
class SessionController extends ChangeNotifier {
  SessionController(this._auth);

  final AuthRepository _auth;
  StreamSubscription<String?>? _subscription;
  SessionStatus _status = SessionStatus.checking;
  String? _userId;
  int _generation = 0;
  bool _evaluated = false;

  SessionStatus get status => _status;
  String? get userId => _userId;

  Future<void> start() async {
    _subscription = _auth.userIdChanges().listen(_onUserChanged);
    await _onUserChanged(_auth.currentUserId);
  }

  Future<void> retryRoleCheck() => _onUserChanged(_userId, force: true);

  Future<void> signOut() => _auth.signOut();

  Future<void> _onUserChanged(String? userId, {bool force = false}) async {
    // 같은 사용자에 대한 중복 알림(초기 세션 이벤트 등)은 무시한다
    if (!force && _evaluated && userId == _userId) return;
    _evaluated = true;
    final generation = ++_generation;
    _userId = userId;
    if (userId == null) return _set(SessionStatus.signedOut);

    _set(SessionStatus.checking);
    try {
      final role = await _auth.fetchRole(userId);
      if (generation != _generation) return; // 그사이 다른 계정으로 바뀜
      _set(role.canUseApp ? SessionStatus.driver : SessionStatus.notDriver);
    } on RoleLookupException {
      if (generation != _generation) return;
      _set(SessionStatus.roleCheckFailed);
    }
  }

  void _set(SessionStatus next) {
    if (_status == next) return;
    _status = next;
    notifyListeners();
  }

  @override
  void dispose() {
    unawaited(_subscription?.cancel());
    super.dispose();
  }
}
