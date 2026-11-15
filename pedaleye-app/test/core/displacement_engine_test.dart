// 웹 tests/displacement-engine.test.ts 와 같은 입력·기대값
import 'package:flutter_test/flutter_test.dart';
import 'package:pedaleye_app/core/telemetry/displacement_engine.dart';

// 유휴 120.50mm, 완전 답입 80.50mm (가동 40mm)
const min = 8050;
const max = 12050;

void main() {
  group('calculatePedalPercentage (역방향 ToF: 거리가 줄수록 답입률 증가)', () {
    test('유휴 거리 0%, 완전 답입 거리 100%, 중간 50%', () {
      expect(calculatePedalPercentage(max, min, max), 0);
      expect(calculatePedalPercentage(min, min, max), 100);
      expect(calculatePedalPercentage(10050, min, max), 50);
    });

    test('거리가 줄어들수록 단조 증가한다', () {
      var previous = -1;
      for (var raw = max; raw >= min; raw -= 100) {
        final percent = calculatePedalPercentage(raw, min, max);
        expect(percent, greaterThanOrEqualTo(previous));
        previous = percent;
      }
    });

    test('2% 이하는 데드존으로 0%, 2% 초과부터 반영', () {
      expect(calculatePedalPercentage(max - 80, min, max), 0); // 정확히 2%
      expect(calculatePedalPercentage(max - 120, min, max), 3); // 3%
    });

    test('범위 밖(오버슈트·언더슈트)은 0~100으로 자른다', () {
      expect(calculatePedalPercentage(max + 500, min, max), 0);
      expect(calculatePedalPercentage(min - 500, min, max), 100);
    });

    test('가동 범위 5mm 미만이면 거부한다', () {
      expect(isValidStroke(10000, 10499), isFalse);
      expect(isValidStroke(10000, 10500), isTrue);
      expect(() => calculatePedalPercentage(10200, 10000, 10499), throwsA(isA<InvalidStrokeException>()));
    });

    test('10mm 변위가 0.01mm 단위로 손실 없이 환산된다', () {
      // 10.00mm = 1000 단위 → 가동 40mm 의 25%
      expect(calculatePedalPercentage(max - 1000, min, max), 25);
      expect(formatMillimeters(max - 1000), '110.50');
      expect(formatMillimeters(12345), '123.45');
    });
  });

  group('summarizeSamples (3초 구간 대표값)', () {
    test('안정된 구간은 평균을 내고 stable', () {
      final samples = List.generate(60, (i) => 12050 + ((i % 5) - 2));
      final s = summarizeSamples(samples);
      expect((s.average, s.stable, s.kept, s.total), (12050, true, 60, 60));
    });

    test('튀는 반사 노이즈는 버리고 평균한다', () {
      final samples = [...List.filled(57, 8050), 20000, 100, 15000];
      final summary = summarizeSamples(samples);
      expect(summary.average, 8050);
      expect(summary.kept, 57);
      expect(summary.stable, isTrue);
    });

    test('측정 중 페달이 움직이면 unstable', () {
      final samples = List.generate(60, (i) => 12050 - i * 50);
      expect(summarizeSamples(samples).stable, isFalse);
    });

    test('샘플이 없으면 unstable', () {
      expect(summarizeSamples([]).stable, isFalse);
    });
  });
}
