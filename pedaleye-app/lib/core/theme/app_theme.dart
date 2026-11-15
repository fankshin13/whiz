import 'package:material_ui/material_ui.dart';

/// 마스터 스펙 'UX 원칙' 색상. 웹 콘솔(app/globals.css)의 토큰과 같은 값이다.
abstract final class AppColors {
  static const accel = Color(0xFF0066FF);
  static const accelBg = Color(0xFFF0F6FF);
  static const brake = Color(0xFFFF3B30);
  static const brakeBg = Color(0xFFFFF2F2);
  static const dualWarning = Color(0xFFFF9500);
  static const primaryAction = Color(0xFF1A1D20);
  static const primaryActionFg = Color(0xFFFFFFFF);
  static const bgBase = Color(0xFFFFFFFF);
  static const bgPanel = Color(0xFFF8F9FA);
  static const border = Color(0xFFE5E7EB);

  /// 입력란 테두리: 비텍스트 대비 3:1 확보용
  static const borderStrong = Color(0xFF6B7280);
  static const textMain = Color(0xFF111827);
  static const textMuted = Color(0xFF4B5563);

  /// 오류 문구 전용(흰 배경 대비 4.5:1 이상). 제동 색(#FF3B30)은 글자색으로 쓰면 대비가 모자란다.
  static const critical = Color(0xFFB91C1C);
  static const criticalBg = Color(0xFFFEF2F2);

  /// 상태(검증 통과) 전용. 웹 --color-good 과 같은 값
  static const good = Color(0xFF15803D);
  static const goodBg = Color(0xFFF0FDF4);
}

/// 4dp 그리드 간격
abstract final class AppSpacing {
  static const s1 = 4.0;
  static const s2 = 8.0;
  static const s3 = 12.0;
  static const s4 = 16.0;
  static const s6 = 24.0;
  static const s8 = 32.0;
}

abstract final class AppRadius {
  /// 컴포넌트 기본
  static const md = 8.0;

  /// 카드·모달
  static const lg = 12.0;
}

abstract final class AppSizes {
  /// 운전석 환경 최소 터치 영역
  static const touch = 48.0;

  /// 본문 최대 폭(태블릿 가로에서 입력 폼이 지나치게 넓어지지 않게)
  static const contentMaxWidth = 480.0;
}

/// 웹과 같은 글자 크기 단계: metric 32 / h1 24 / h2 18 / body 14(앱은 가독성을 위해 16) / caption 12
abstract final class AppTypography {
  static const fontFamily = 'Pretendard';

  static const textTheme = TextTheme(
    displaySmall: TextStyle(
      fontFamily: fontFamily,
      fontSize: 32,
      height: 1.25,
      fontWeight: FontWeight.w700,
      color: AppColors.textMain,
    ),
    headlineSmall: TextStyle(
      fontFamily: fontFamily,
      fontSize: 24,
      height: 1.35,
      fontWeight: FontWeight.w700,
      color: AppColors.textMain,
    ),
    titleMedium: TextStyle(
      fontFamily: fontFamily,
      fontSize: 18,
      height: 1.4,
      fontWeight: FontWeight.w600,
      color: AppColors.textMain,
    ),
    bodyLarge: TextStyle(fontFamily: fontFamily, fontSize: 16, height: 1.6, color: AppColors.textMain),
    bodyMedium: TextStyle(fontFamily: fontFamily, fontSize: 14, height: 1.6, color: AppColors.textMain),
    labelLarge: TextStyle(fontFamily: fontFamily, fontSize: 16, height: 1.4, fontWeight: FontWeight.w600),
    bodySmall: TextStyle(fontFamily: fontFamily, fontSize: 12, height: 1.5, color: AppColors.textMuted),
  );
}

abstract final class AppTheme {
  static ThemeData light() {
    final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.md));
    const minButton = Size(AppSizes.touch, AppSizes.touch);
    OutlineInputBorder outline(Color color, [double width = 1]) => OutlineInputBorder(
      borderRadius: BorderRadius.circular(AppRadius.md),
      borderSide: BorderSide(color: color, width: width),
    );

    return ThemeData(
      useMaterial3: true,
      fontFamily: AppTypography.fontFamily,
      fontFamilyFallback: const ['Noto Sans KR', 'Noto Sans CJK KR'],
      colorScheme: const ColorScheme.light(
        primary: AppColors.primaryAction,
        onPrimary: AppColors.primaryActionFg,
        secondary: AppColors.accel,
        onSecondary: AppColors.primaryActionFg,
        error: AppColors.critical,
        onError: AppColors.primaryActionFg,
        surface: AppColors.bgBase,
        onSurface: AppColors.textMain,
        onSurfaceVariant: AppColors.textMuted,
        surfaceContainerLow: AppColors.bgPanel,
        outline: AppColors.borderStrong,
        outlineVariant: AppColors.border,
      ),
      scaffoldBackgroundColor: AppColors.bgBase,
      textTheme: AppTypography.textTheme,
      materialTapTargetSize: MaterialTapTargetSize.padded,
      visualDensity: VisualDensity.standard,
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.bgBase,
        foregroundColor: AppColors.textMain,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        shape: Border(bottom: BorderSide(color: AppColors.border)),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.primaryAction,
          foregroundColor: AppColors.primaryActionFg,
          disabledBackgroundColor: AppColors.primaryAction.withValues(alpha: 0.7),
          disabledForegroundColor: AppColors.primaryActionFg,
          minimumSize: minButton,
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s4),
          shape: shape,
          textStyle: AppTypography.textTheme.labelLarge,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.primaryAction,
          minimumSize: minButton,
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s4),
          side: const BorderSide(color: AppColors.primaryAction),
          shape: shape,
          textStyle: AppTypography.textTheme.labelLarge,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppColors.accel,
          minimumSize: minButton,
          shape: shape,
          textStyle: AppTypography.textTheme.labelLarge,
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.bgBase,
        constraints: const BoxConstraints(minHeight: AppSizes.touch),
        contentPadding: const EdgeInsets.symmetric(horizontal: AppSpacing.s3, vertical: AppSpacing.s3),
        border: outline(AppColors.borderStrong),
        enabledBorder: outline(AppColors.borderStrong),
        focusedBorder: outline(AppColors.accel, 2),
        errorBorder: outline(AppColors.critical),
        focusedErrorBorder: outline(AppColors.critical, 2),
        labelStyle: const TextStyle(color: AppColors.textMuted),
        floatingLabelStyle: const TextStyle(color: AppColors.textMain),
        errorStyle: const TextStyle(color: AppColors.critical, fontSize: 13),
        errorMaxLines: 3,
      ),
      cardTheme: CardThemeData(
        color: AppColors.bgPanel,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.lg),
          side: const BorderSide(color: AppColors.border),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: AppColors.bgBase,
        indicatorColor: AppColors.accelBg,
        surfaceTintColor: Colors.transparent,
        height: 64,
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => TextStyle(
            fontSize: 12,
            fontWeight: states.contains(WidgetState.selected) ? FontWeight.w600 : FontWeight.w400,
            color: states.contains(WidgetState.selected) ? AppColors.textMain : AppColors.textMuted,
          ),
        ),
        iconTheme: WidgetStateProperty.resolveWith(
          (states) =>
              IconThemeData(color: states.contains(WidgetState.selected) ? AppColors.accel : AppColors.textMuted),
        ),
      ),
      snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
      progressIndicatorTheme: const ProgressIndicatorThemeData(color: AppColors.primaryAction),
    );
  }
}
