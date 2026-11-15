import 'package:material_ui/material_ui.dart';

import 'screen_body.dart';
import 'status_message.dart';

/// 후속 작업에서 채울 탭의 안내 화면
class ComingSoonScreen extends StatelessWidget {
  const ComingSoonScreen({super.key, required this.title, required this.icon, required this.message});

  final String title;
  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: ScreenBody(
        center: true,
        children: [StatusMessage(icon: icon, title: '준비 중인 기능입니다', message: message)],
      ),
    );
  }
}
