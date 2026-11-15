import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/application/session_controller.dart';
import '../../features/auth/presentation/invite_screen.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/auth/presentation/not_driver_screen.dart';
import '../../features/auth/presentation/session_screens.dart';
import '../../features/calibration/presentation/pedal_calibration_screen.dart';
import '../../features/gauge/presentation/pedal_gauge_screen.dart';
import '../../features/home/presentation/home_screen.dart';
import '../../features/records/presentation/records_placeholder_screen.dart';
import '../../features/shell/presentation/app_shell.dart';

const _signedOutPaths = {'/login', '/invite'};
const _driverPaths = {'/home', '/calibrate', '/gauge', '/records'};

/// 딥링크 pedaleye://invite?token=… 는 호스트가 'invite' 라 경로로 바꿔 준다.
/// 웹 초대 주소(…/auth/invite?token=…)를 앱 링크로 받는 경우도 같은 화면으로 보낸다.
String? normalizeDeepLink(Uri uri) {
  final isCustomScheme = uri.scheme == 'pedaleye' && uri.host == 'invite';
  if (isCustomScheme || uri.path == '/auth/invite') {
    final token = uri.queryParameters['token'];
    return Uri(path: '/invite', queryParameters: token == null ? null : {'token': token}).toString();
  }
  return null;
}

/// 세션 상태에 맞는 화면으로 보낸다. 운전자가 아니면 홈·데이터 화면에 절대 들어가지 못한다.
String? sessionRedirect(SessionStatus status, Uri uri) {
  final normalized = normalizeDeepLink(uri);
  if (normalized != null) {
    return status == SessionStatus.signedOut ? normalized : sessionRedirect(status, Uri.parse(normalized));
  }
  final path = uri.path;
  final target = switch (status) {
    SessionStatus.checking => '/checking',
    SessionStatus.notDriver => '/not-driver',
    SessionStatus.roleCheckFailed => '/connect-error',
    SessionStatus.signedOut => _signedOutPaths.contains(path) ? null : '/login',
    SessionStatus.driver => _driverPaths.contains(path) ? null : '/home',
  };
  return target == path ? null : target;
}

GoRouter createRouter(SessionController session) {
  return GoRouter(
    initialLocation: '/home',
    refreshListenable: session,
    redirect: (context, state) => sessionRedirect(session.status, state.uri),
    routes: [
      GoRoute(path: '/checking', builder: (context, state) => const SessionCheckingScreen()),
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      GoRoute(
        path: '/invite',
        builder: (context, state) => InviteScreen(
          key: ValueKey(state.uri.queryParameters['token']),
          initialToken: state.uri.queryParameters['token'],
        ),
      ),
      GoRoute(path: '/not-driver', builder: (context, state) => const NotDriverScreen()),
      GoRoute(path: '/connect-error', builder: (context, state) => const RoleCheckFailedScreen()),
      // 주행 중 화면: 탭 바 없이 전체 화면
      GoRoute(path: '/gauge', builder: (context, state) => const PedalGaugeScreen()),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => AppShell(navigationShell: shell),
        branches: [
          StatefulShellBranch(
            routes: [GoRoute(path: '/home', builder: (context, state) => const HomeScreen())],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/calibrate', builder: (context, state) => const PedalCalibrationScreen())],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/records', builder: (context, state) => const RecordsPlaceholderScreen())],
          ),
        ],
      ),
    ],
  );
}
