import 'package:material_ui/material_ui.dart';

import '../../../core/widgets/coming_soon.dart';

class CalibrationPlaceholderScreen extends StatelessWidget {
  const CalibrationPlaceholderScreen({super.key});

  @override
  Widget build(BuildContext context) =>
      const ComingSoonScreen(title: '페달 보정', icon: Icons.tune, message: '페달 영점·가동 범위 보정과 실시간 게이지는 다음 업데이트에서 제공됩니다.');
}
