import 'package:material_ui/material_ui.dart';

import '../text/keep_all.dart';
import '../theme/app_theme.dart';

/// 빈 상태·오류 상태 공통 안내: 아이콘 + 제목 + 설명 + 다음 행동
class StatusMessage extends StatelessWidget {
  const StatusMessage({
    super.key,
    required this.icon,
    required this.title,
    this.message,
    this.iconColor = AppColors.textMuted,
    this.actions = const [],
  });

  final IconData icon;
  final String title;
  final String? message;
  final Color iconColor;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Semantics(
      liveRegion: true,
      container: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Icon(icon, size: 40, color: iconColor),
          const SizedBox(height: AppSpacing.s3),
          Text(keepAll(title), style: text.titleMedium, textAlign: TextAlign.center),
          if (message != null) ...[
            const SizedBox(height: AppSpacing.s2),
            Text(
              keepAll(message!),
              style: text.bodyLarge?.copyWith(color: AppColors.textMuted),
              textAlign: TextAlign.center,
            ),
          ],
          for (final action in actions) ...[const SizedBox(height: AppSpacing.s3), action],
        ],
      ),
    );
  }
}
