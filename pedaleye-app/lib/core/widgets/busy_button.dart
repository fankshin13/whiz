import 'package:material_ui/material_ui.dart';

import '../theme/app_theme.dart';

/// 제출 중에는 글자 대신 진행 표시를 보여 주고 다시 누를 수 없게 한다.
class BusyButton extends StatelessWidget {
  const BusyButton({super.key, required this.label, required this.busy, required this.onPressed, this.busyLabel});

  final String label;
  final String? busyLabel;
  final bool busy;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      onPressed: busy ? null : onPressed,
      child: busy
          ? Semantics(
              label: busyLabel ?? '처리 중',
              liveRegion: true,
              child: const SizedBox.square(
                dimension: 22,
                child: CircularProgressIndicator(strokeWidth: 2.5, color: AppColors.primaryActionFg),
              ),
            )
          : Text(label),
    );
  }
}
