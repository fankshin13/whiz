import 'package:material_ui/material_ui.dart';

import '../../../core/widgets/coming_soon.dart';

class RecordsPlaceholderScreen extends StatelessWidget {
  const RecordsPlaceholderScreen({super.key});

  @override
  Widget build(BuildContext context) =>
      const ComingSoonScreen(title: '사고 기록', icon: Icons.history, message: '사고 기록 백업·업로드와 내 기록 조회는 다음 업데이트에서 제공됩니다.');
}
