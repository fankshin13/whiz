import 'package:material_ui/material_ui.dart';

import '../theme/app_theme.dart';

/// 세로 스크롤 + 가운데 정렬 + 최대 폭. 320dp 화면과 큰 글자 설정에서도 잘리지 않게 한다.
class ScreenBody extends StatelessWidget {
  const ScreenBody({super.key, required this.children, this.center = false});

  final List<Widget> children;
  final bool center;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: LayoutBuilder(
        builder: (context, constraints) => SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.s4),
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: center ? constraints.maxHeight - AppSpacing.s8 : 0),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: AppSizes.contentMaxWidth),
                child: Column(
                  mainAxisAlignment: center ? MainAxisAlignment.center : MainAxisAlignment.start,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: children,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
