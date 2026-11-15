import 'package:material_ui/material_ui.dart';

import '../text/keep_all.dart';
import '../theme/app_theme.dart';

/// 폼 아래 오류 안내. 색만으로 구분하지 않도록 아이콘과 문장을 함께 쓰고, 화면 낭독기에 바로 알린다.
class FormError extends StatelessWidget {
  const FormError(this.message, {super.key});
  final String message;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.s3),
        decoration: BoxDecoration(
          color: AppColors.criticalBg,
          borderRadius: BorderRadius.circular(AppRadius.md),
          border: const Border(left: BorderSide(color: AppColors.critical, width: 4)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.error_outline, color: AppColors.critical, size: 20),
            const SizedBox(width: AppSpacing.s2),
            Expanded(
              child: Text(
                keepAll(message),
                style: const TextStyle(color: AppColors.critical, fontSize: 14, height: 1.5),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
