/// ToF 거리 → 페달 답입률(0~100%) 변환. 웹 lib/telemetry/displacement-engine.ts 와 같은 규칙이다.
///
/// 센서는 페달 뒤 격벽에 달려 있어 페달을 밟을수록 거리가 줄어든다.
///   calibMax = 0% 유휴 시 거리(가장 멂), calibMin = 100% 완전 답입 시 거리(가장 가까움)
///   percent = (calibMax − raw) / (calibMax − calibMin) × 100, 2% 이하 데드존 → 0, 0~100 으로 자름
/// 거리 단위는 모두 0.01mm 정수(120.50mm → 12050).
library;

import 'dart:math' as math;

/// 최소 유효 가동 거리 5.00mm
const minStroke = 500;
const deadzonePercent = 2;

/// 측정 구간 흔들림 허용치 1.00mm
const stabilityTolerance = 100;
const _outlierMadFactor = 3;
const _minKeptRatio = 0.8;

bool isValidStroke(int calibMin, int calibMax) => calibMax - calibMin >= minStroke;

/// 가동 범위가 5mm 미만일 때
class InvalidStrokeException implements Exception {
  const InvalidStrokeException();

  @override
  String toString() => '가동 범위가 ${minStroke / 100}mm 미만입니다.';
}

/// 답입률(정수 %). 가동 범위가 5mm 미만이면 [InvalidStrokeException].
int calculatePedalPercentage(int rawDistance, int calibMin, int calibMax) {
  if (!isValidStroke(calibMin, calibMax)) throw const InvalidStrokeException();
  final rawPercent = (calibMax - rawDistance) / (calibMax - calibMin) * 100;
  if (rawPercent <= deadzonePercent) return 0;
  return _jsRound(math.min(100, rawPercent));
}

/// JavaScript Math.round 와 같은 반올림(.5 는 +∞ 방향). Dart round() 는 음수 .5 를 0에서 멀게 보낸다.
int _jsRound(num value) => (value + 0.5).floor();

double _median(List<num> sorted) {
  final mid = sorted.length ~/ 2;
  return sorted.length.isEven ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid].toDouble();
}

class SampleSummary {
  const SampleSummary({
    required this.average,
    required this.spread,
    required this.kept,
    required this.total,
    required this.stable,
  });

  /// 0.01mm 정수
  final int average;

  /// 이상치 제외 후 최대−최소
  final int spread;
  final int kept;
  final int total;
  final bool stable;
}

/// 3초 수집 구간의 대표 거리. 중앙값 기준 MAD×3 를 벗어난 튀는 값(반사 노이즈)을 버리고 평균한다.
/// 남은 값의 흔들림이 1mm 이하이고 80% 이상 남아야 안정(stable)으로 본다.
SampleSummary summarizeSamples(List<int> samples) {
  if (samples.isEmpty) return const SampleSummary(average: 0, spread: 0, kept: 0, total: 0, stable: false);

  final sorted = [...samples]..sort();
  final med = _median(sorted);
  final mad = _median(sorted.map((v) => (v - med).abs()).toList()..sort());
  final limit = math.max(mad * _outlierMadFactor, stabilityTolerance / 2);
  final kept = sorted.where((v) => (v - med).abs() <= limit).toList();

  final average = _jsRound(kept.fold<int>(0, (sum, v) => sum + v) / kept.length);
  final spread = kept.last - kept.first;
  return SampleSummary(
    average: average,
    spread: spread,
    kept: kept.length,
    total: samples.length,
    stable: spread <= stabilityTolerance && kept.length / samples.length >= _minKeptRatio,
  );
}

/// 0.01mm 정수 → "120.50"
String formatMillimeters(int distance) => (distance / 100).toStringAsFixed(2);
