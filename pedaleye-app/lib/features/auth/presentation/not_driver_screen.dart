import 'package:material_ui/material_ui.dart';
import 'package:flutter/services.dart';

import '../../../app_scope.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/screen_body.dart';
import '../../../core/widgets/status_message.dart';

const notDriverTitle = '운전자 전용 앱입니다';
const notDriverMessage = '관리자 및 사고조사관 계정은 모바일 앱을 이용하실 수 없습니다. PC 웹 브라우저에서 웹 관리 콘솔에 접속해 주세요.';

/// 운전자가 아닌 역할. 앱 기능·데이터 화면에는 들어갈 수 없고 로그아웃만 할 수 있다.
class NotDriverScreen extends StatelessWidget {
  const NotDriverScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final scope = AppScope.of(context);
    final consoleUrl = scope.webConsoleUrl.toString();
    return Scaffold(
      body: ScreenBody(
        center: true,
        children: [
          const StatusMessage(
            icon: Icons.warning_amber_rounded,
            iconColor: AppColors.dualWarning,
            title: notDriverTitle,
            message: notDriverMessage,
          ),
          const SizedBox(height: AppSpacing.s4),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.s4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('웹 관리 콘솔 주소', style: Theme.of(context).textTheme.bodySmall),
                  const SizedBox(height: AppSpacing.s1),
                  SelectableText(consoleUrl, style: Theme.of(context).textTheme.bodyLarge),
                  const SizedBox(height: AppSpacing.s2),
                  OutlinedButton.icon(
                    onPressed: () async {
                      await Clipboard.setData(ClipboardData(text: consoleUrl));
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('주소를 복사했습니다.')));
                      }
                    },
                    icon: const Icon(Icons.copy),
                    label: const Text('주소 복사'),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.s6),
          FilledButton.icon(
            onPressed: scope.session.signOut,
            icon: const Icon(Icons.logout),
            label: const Text('로그아웃'),
          ),
        ],
      ),
    );
  }
}
