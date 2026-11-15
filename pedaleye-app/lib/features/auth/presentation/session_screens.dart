import 'package:material_ui/material_ui.dart';

import '../../../app_scope.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/screen_body.dart';
import '../../../core/widgets/status_message.dart';

/// 저장된 세션 복원·역할 확인 중
class SessionCheckingScreen extends StatelessWidget {
  const SessionCheckingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Semantics(
          liveRegion: true,
          label: '로그인 정보를 확인하고 있습니다',
          child: const Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircularProgressIndicator(),
              SizedBox(height: AppSpacing.s4),
              ExcludeSemantics(child: Text('로그인 정보를 확인하고 있습니다...')),
            ],
          ),
        ),
      ),
    );
  }
}

/// 로그인은 돼 있지만 역할을 확인하지 못함(오프라인 등). 역할을 모르면 앱 기능을 열지 않는다.
class RoleCheckFailedScreen extends StatefulWidget {
  const RoleCheckFailedScreen({super.key});

  @override
  State<RoleCheckFailedScreen> createState() => _RoleCheckFailedScreenState();
}

class _RoleCheckFailedScreenState extends State<RoleCheckFailedScreen> {
  bool _busy = false;

  Future<void> _retry() async {
    setState(() => _busy = true);
    await AppScope.of(context).session.retryRoleCheck();
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final session = AppScope.of(context).session;
    return Scaffold(
      body: ScreenBody(
        center: true,
        children: [
          StatusMessage(
            icon: Icons.wifi_off,
            title: '계정 정보를 확인할 수 없습니다',
            message: '서버와 통신할 수 없습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
            actions: [
              FilledButton(onPressed: _busy ? null : _retry, child: const Text('다시 시도')),
              OutlinedButton(onPressed: _busy ? null : session.signOut, child: const Text('로그아웃')),
            ],
          ),
        ],
      ),
    );
  }
}
