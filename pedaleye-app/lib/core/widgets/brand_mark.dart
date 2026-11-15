import 'package:material_ui/material_ui.dart';

import '../theme/app_theme.dart';

/// 페달아이 심볼: 가속(파랑)·제동(빨강) 두 페달 막대
class BrandMark extends StatelessWidget {
  const BrandMark({super.key});

  @override
  Widget build(BuildContext context) {
    Widget bar(Color color, double height) => Container(
      width: 12,
      height: height,
      decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(3)),
    );
    return Semantics(
      label: '페달아이',
      header: true,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          ExcludeSemantics(child: bar(AppColors.accel, 28)),
          const SizedBox(width: 4),
          ExcludeSemantics(child: bar(AppColors.brake, 20)),
          const SizedBox(width: AppSpacing.s3),
          ExcludeSemantics(child: Text('페달아이', style: Theme.of(context).textTheme.headlineSmall)),
        ],
      ),
    );
  }
}
