import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:pedaleye_app/core/text/keep_all.dart';
import 'package:pedaleye_app/core/theme/app_theme.dart';

void main() {
  test('마스터 스펙 색상 토큰', () {
    expect(AppColors.accel, const Color(0xFF0066FF));
    expect(AppColors.brake, const Color(0xFFFF3B30));
    expect(AppColors.dualWarning, const Color(0xFFFF9500));
    expect(AppColors.primaryAction, const Color(0xFF1A1D20));
    expect(AppColors.textMain, const Color(0xFF111827));
    expect(AppColors.bgPanel, const Color(0xFFF8F9FA));
  });

  test('버튼·입력란 최소 터치 영역 48dp, 폰트 Pretendard', () {
    final theme = AppTheme.light();
    expect(theme.filledButtonTheme.style?.minimumSize?.resolve({}), const Size(48, 48));
    expect(theme.outlinedButtonTheme.style?.minimumSize?.resolve({}), const Size(48, 48));
    expect(theme.inputDecorationTheme.constraints?.minHeight, 48);
    expect(theme.textTheme.bodyLarge?.fontFamily, 'Pretendard');
  });

  test('오류 글자색은 흰 배경 대비 4.5:1 이상', () {
    double contrast(Color a, Color b) {
      final la = a.computeLuminance(), lb = b.computeLuminance();
      return (la > lb ? la + 0.05 : lb + 0.05) / (la > lb ? lb + 0.05 : la + 0.05);
    }

    expect(contrast(AppColors.critical, AppColors.bgBase), greaterThan(4.5));
    expect(contrast(AppColors.critical, AppColors.criticalBg), greaterThan(4.5));
    expect(contrast(AppColors.textMuted, AppColors.bgPanel), greaterThan(4.5));
    expect(contrast(AppColors.borderStrong, AppColors.bgBase), greaterThan(3));
  });

  test('keepAll: 어절 안에만 단어 결합자를 넣고 띄어쓰기는 유지', () {
    expect(keepAll('차량 정보'), '차\u2060량 정\u2060보');
    expect(keepAll('차량 정보').replaceAll('\u2060', ''), '차량 정보');
  });
}
