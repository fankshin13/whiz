import 'package:material_ui/material_ui.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/text/keep_all.dart';

enum GaugePedal { accel, brake }

extension on GaugePedal {
  String get label => this == GaugePedal.accel ? '가속' : '제동';
  Color get color => this == GaugePedal.accel ? AppColors.accel : AppColors.brake;
  Color get background => this == GaugePedal.accel ? AppColors.accelBg : AppColors.brakeBg;
}

/// 한 페달의 답입률 숫자 + 5단계 LED 블록(아래에서 위로 켜짐).
/// litLevel 은 실제 LED 와 같은 규칙(가속·제동 중 하나만 켜짐)으로 정한 값, dual 이면 주황으로 모두 켠다.
class PedalLevelGauge extends StatelessWidget {
  const PedalLevelGauge({
    super.key,
    required this.pedal,
    required this.percent,
    required this.litLevel,
    this.dual = false,
    this.compact = false,
  });

  final GaugePedal pedal;
  final num percent;
  final int litLevel;
  final bool dual;

  /// 캘리브레이션 반응 테스트처럼 좁은 자리에 넣을 때
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final blockHeight = compact ? 14.0 : 36.0;
    return Semantics(
      label: '${pedal.label} 페달 ${percent.round()}퍼센트, ${dual ? '양발 조작 경고' : '$litLevel단계'}',
      child: ExcludeSemantics(
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.s3),
          decoration: BoxDecoration(
            color: pedal.background,
            borderRadius: BorderRadius.circular(AppRadius.lg),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('${pedal.label} 페달', style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: Text(
                  '${percent.round()}%',
                  style: (compact ? text.headlineSmall : text.displaySmall)?.copyWith(
                    color: pedal.color,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ),
              SizedBox(height: compact ? AppSpacing.s1 : AppSpacing.s2),
              for (var level = 5; level >= 1; level--) ...[
                _LedBlock(
                  height: blockHeight,
                  color: dual ? AppColors.dualWarning : pedal.color,
                  lit: dual || level <= litLevel,
                ),
                if (level > 1) const SizedBox(height: 4),
              ],
              if (!compact) ...[
                const SizedBox(height: AppSpacing.s2),
                Text(dual ? '양발 경고' : '$litLevel단계', style: text.bodySmall, textAlign: TextAlign.center),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _LedBlock extends StatelessWidget {
  const _LedBlock({required this.height, required this.color, required this.lit});
  final double height;
  final Color color;
  final bool lit;

  @override
  Widget build(BuildContext context) {
    // 꺼진 칸도 테두리로 자리를 보여 줘서 색만으로 단계를 구분하지 않게 한다
    return Container(
      height: height,
      decoration: BoxDecoration(
        color: lit ? color : AppColors.bgBase,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: lit ? color : AppColors.borderStrong),
      ),
    );
  }
}

/// 양발 동시 조작 경고 배너. 점멸은 초당 3회 미만, 움직임 줄이기 설정이면 멈춘다.
class DualWarningBanner extends StatefulWidget {
  const DualWarningBanner({super.key});

  static const message = '양발 조작 감지! 한쪽 페달에서 즉시 발을 떼세요.';

  @override
  State<DualWarningBanner> createState() => _DualWarningBannerState();
}

class _DualWarningBannerState extends State<DualWarningBanner> with SingleTickerProviderStateMixin {
  late final AnimationController _blink = AnimationController(vsync: this, duration: const Duration(milliseconds: 400));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.of(context).disableAnimations) {
      _blink.value = 1;
    } else if (!_blink.isAnimating) {
      _blink.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _blink.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      child: FadeTransition(
        opacity: Tween<double>(begin: 0.55, end: 1).animate(_blink),
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.s3),
          decoration: BoxDecoration(color: AppColors.dualWarning, borderRadius: BorderRadius.circular(AppRadius.md)),
          child: Row(
            children: [
              const Icon(Icons.warning_rounded, color: AppColors.textMain, size: 28),
              const SizedBox(width: AppSpacing.s2),
              Expanded(
                child: Text(
                  keepAll(DualWarningBanner.message),
                  style: const TextStyle(
                    color: AppColors.textMain,
                    fontWeight: FontWeight.w700,
                    fontSize: 16,
                    height: 1.4,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
