import 'package:flutter/widgets.dart';

import 'features/auth/application/session_controller.dart';
import 'features/auth/data/auth_repository.dart';
import 'features/auth/data/invite_repository.dart';
import 'features/home/data/driver_home_repository.dart';

/// 화면이 쓰는 의존성 묶음. 테스트에서는 가짜 저장소로 바꿔 끼운다.
class AppScope extends InheritedWidget {
  const AppScope({
    super.key,
    required this.session,
    required this.auth,
    required this.invites,
    required this.home,
    required this.webConsoleUrl,
    required super.child,
  });

  final SessionController session;
  final AuthRepository auth;
  final InviteRepository invites;
  final DriverHomeRepository home;
  final Uri webConsoleUrl;

  static AppScope of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<AppScope>();
    assert(scope != null, 'AppScope 가 위젯 트리에 없습니다.');
    return scope!;
  }

  @override
  bool updateShouldNotify(AppScope oldWidget) =>
      session != oldWidget.session || auth != oldWidget.auth || invites != oldWidget.invites || home != oldWidget.home;
}
