import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';

import '../../../core/forensics/packet_codec.dart';
import '../../../core/theme/app_theme.dart';

/// 사고 전후 페달 답입률 시계열. 가속(청)·제동(적) 두 선은 같은 단위(%)라 한 축을 쓰고,
/// 양발 동시 조작 구간은 주황 띠로 표시한다. 누르거나 끌면 그 시각의 값을 보여 준다.
class PedalTimelineChart extends StatefulWidget {
  const PedalTimelineChart({super.key, required this.packets});

  final List<PacketRecord> packets;

  @override
  State<PedalTimelineChart> createState() => _PedalTimelineChartState();
}

class _PedalTimelineChartState extends State<PedalTimelineChart> {
  int? _selected;
  late _Series _series = _Series.from(widget.packets);

  @override
  void didUpdateWidget(PedalTimelineChart old) {
    super.didUpdateWidget(old);
    if (old.packets != widget.packets) _series = _Series.from(widget.packets);
  }

  void _select(Offset local, double width) {
    final s = _series;
    final x = ((local.dx - _ChartPainter.leftPad) / (width - _ChartPainter.leftPad)).clamp(0.0, 1.0);
    final t = s.minT + x * (s.maxT - s.minT);
    var best = 0;
    for (var i = 1; i < s.t.length; i++) {
      if ((s.t[i] - t).abs() < (s.t[best] - t).abs()) best = i;
    }
    setState(() => _selected = best);
  }

  @override
  Widget build(BuildContext context) {
    final s = _series;
    final text = Theme.of(context).textTheme;
    if (s.t.isEmpty) return Text('표시할 기록이 없습니다.', style: text.bodyMedium);
    final sel = _selected;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          sel == null
              ? '그래프를 누르거나 끌면 그 시각의 값을 보여 줍니다.'
              : '${_fmtSec(s.t[sel])} · 가속 ${s.accel[sel]}% · 제동 ${s.brake[sel]}%${s.dual[sel] ? ' · 양발 조작' : ''}',
          style: text.bodySmall?.copyWith(color: sel == null ? AppColors.textMuted : AppColors.textMain),
        ),
        const SizedBox(height: AppSpacing.s2),
        Semantics(
          label:
              '페달 답입률 그래프. 가속 최대 ${s.accel.reduce(math.max)}%, 제동 최대 ${s.brake.reduce(math.max)}%, '
              '양발 조작 ${s.dualSeconds.toStringAsFixed(1)}초',
          child: LayoutBuilder(
            builder: (context, constraints) => GestureDetector(
              onTapDown: (d) => _select(d.localPosition, constraints.maxWidth),
              onHorizontalDragUpdate: (d) => _select(d.localPosition, constraints.maxWidth),
              child: RepaintBoundary(
                child: CustomPaint(
                  size: Size(constraints.maxWidth, 220),
                  painter: _ChartPainter(s, sel, Theme.of(context).textTheme.bodySmall!),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.s2),
        const Wrap(
          spacing: AppSpacing.s4,
          runSpacing: AppSpacing.s1,
          children: [
            _Legend(color: AppColors.accel, label: '가속 페달'),
            _Legend(color: AppColors.brake, label: '제동 페달'),
            _Legend(color: AppColors.dualWarning, label: '양발 조작 구간', band: true),
          ],
        ),
      ],
    );
  }
}

String _fmtSec(double seconds) {
  final v = seconds.toStringAsFixed(seconds.abs() < 10 ? 2 : 1);
  return seconds > 0 ? '+$v초' : '$v초';
}

class _Legend extends StatelessWidget {
  const _Legend({required this.color, required this.label, this.band = false});
  final Color color;
  final String label;
  final bool band;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(width: 18, height: band ? 12 : 3, color: band ? color.withValues(alpha: 0.25) : color),
        const SizedBox(width: AppSpacing.s1),
        Text(label, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.textMain)),
      ],
    );
  }
}

/// 화면 폭에 맞게 줄인 시계열(최대 400구간, 구간마다 최댓값을 남겨 급제동 같은 순간 값을 잃지 않음)
class _Series {
  _Series(this.t, this.accel, this.brake, this.dual, this.bands, this.dualSeconds);

  final List<double> t; // 초(트리거 기준)
  final List<int> accel;
  final List<int> brake;
  final List<bool> dual;
  final List<(double, double)> bands;
  final double dualSeconds;

  double get minT => t.first;
  double get maxT => t.last == t.first ? t.first + 1 : t.last;

  factory _Series.from(List<PacketRecord> packets) {
    if (packets.isEmpty) return _Series(const [], const [], const [], const [], const [], 0);
    final first = packets.first.timestampMs;
    final last = packets.last.timestampMs;
    // 기록기는 트리거 전후 30초씩 묶으므로 60초 세션이면 가운데가 트리거 시점
    final zero = last - first >= 59000 ? first + 30000 : first;
    double sec(int ms) => (ms - zero) / 1000;

    final bucket = math.max(1, (packets.length / 400).ceil());
    final t = <double>[], a = <int>[], b = <int>[], d = <bool>[];
    for (var i = 0; i < packets.length; i += bucket) {
      final chunk = packets.sublist(i, math.min(i + bucket, packets.length));
      t.add(sec(chunk.first.timestampMs));
      a.add(chunk.map((p) => p.accelPercent).reduce(math.max));
      b.add(chunk.map((p) => p.brakePercent).reduce(math.max));
      d.add(chunk.any((p) => p.bothPedal));
    }

    final bands = <(double, double)>[];
    var dualMs = 0;
    int? runStart;
    for (var i = 0; i < packets.length; i++) {
      final p = packets[i];
      if (p.bothPedal) {
        runStart ??= p.timestampMs;
        if (i > 0 && packets[i - 1].bothPedal) dualMs += p.timestampMs - packets[i - 1].timestampMs;
      }
      final endsHere = runStart != null && (!p.bothPedal || i == packets.length - 1);
      if (endsHere) {
        bands.add((sec(runStart), sec(p.timestampMs)));
        runStart = null;
      }
    }
    return _Series(t, a, b, d, bands, dualMs / 1000);
  }
}

class _ChartPainter extends CustomPainter {
  _ChartPainter(this.s, this.selected, this.labelStyle);

  static const leftPad = 34.0;
  static const bottomPad = 22.0;
  final _Series s;
  final int? selected;
  final TextStyle labelStyle;

  @override
  void paint(Canvas canvas, Size size) {
    final plot = Rect.fromLTRB(leftPad, 6, size.width, size.height - bottomPad);
    double x(double t) => plot.left + (t - s.minT) / (s.maxT - s.minT) * plot.width;
    double y(num v) => plot.bottom - v / 100 * plot.height;

    // 양발 조작 띠
    final band = Paint()..color = AppColors.dualWarning.withValues(alpha: 0.25);
    for (final (from, to) in s.bands) {
      canvas.drawRect(Rect.fromLTRB(x(from), plot.top, math.max(x(to), x(from) + 2), plot.bottom), band);
    }

    // 눈금·격자
    final grid = Paint()
      ..color = AppColors.border
      ..strokeWidth = 1;
    for (final v in [0, 50, 100]) {
      canvas.drawLine(Offset(plot.left, y(v)), Offset(plot.right, y(v)), grid);
      _label(canvas, '$v%', Offset(0, y(v) - 7), width: leftPad - 4, align: TextAlign.right);
    }
    final ticks = s.minT < 0
        ? [-30.0, -15.0, 0.0, 15.0, 30.0]
        : [0.0, (s.maxT / 2).roundToDouble(), s.maxT.roundToDouble()];
    final shown = ticks.where((t) => t >= s.minT - 0.5 && t <= s.maxT + 0.5).toList();
    for (final (i, t) in shown.indexed) {
      final px = x(t.clamp(s.minT, s.maxT));
      final label = t == 0 && s.minT < 0 ? '0(사고)' : '${t > 0 && s.minT < 0 ? '+' : ''}${t.toInt()}초';
      // 양 끝 눈금 글자는 그래프 안쪽으로 붙여 잘리지 않게 한다
      final (left, align) = i == 0
          ? (px, TextAlign.left)
          : i == shown.length - 1
          ? (px - 60, TextAlign.right)
          : (px - 30, TextAlign.center);
      _label(canvas, label, Offset(left, plot.bottom + 4), width: 60, align: align);
    }
    if (s.minT < 0) {
      canvas.drawLine(
        Offset(x(0), plot.top),
        Offset(x(0), plot.bottom),
        Paint()
          ..color = AppColors.textMuted
          ..strokeWidth = 1,
      );
    }

    // 두 선
    void line(List<int> values, Color color) {
      final path = Path()..moveTo(x(s.t.first), y(values.first));
      for (var i = 1; i < values.length; i++) {
        path.lineTo(x(s.t[i]), y(values[i]));
      }
      canvas.drawPath(
        path,
        Paint()
          ..color = color
          ..strokeWidth = 2
          ..style = PaintingStyle.stroke
          ..strokeJoin = StrokeJoin.round,
      );
    }

    line(s.accel, AppColors.accel);
    line(s.brake, AppColors.brake);

    final sel = selected;
    if (sel != null) {
      final px = x(s.t[sel]);
      canvas.drawLine(
        Offset(px, plot.top),
        Offset(px, plot.bottom),
        Paint()
          ..color = AppColors.textMain
          ..strokeWidth = 1,
      );
      for (final (v, c) in [(s.accel[sel], AppColors.accel), (s.brake[sel], AppColors.brake)]) {
        canvas.drawCircle(Offset(px, y(v)), 4, Paint()..color = AppColors.bgBase);
        canvas.drawCircle(
          Offset(px, y(v)),
          4,
          Paint()
            ..color = c
            ..style = PaintingStyle.stroke
            ..strokeWidth = 2,
        );
      }
    }
  }

  void _label(Canvas canvas, String text, Offset at, {required double width, required TextAlign align}) {
    final painter = TextPainter(
      text: TextSpan(
        text: text,
        style: labelStyle.copyWith(color: AppColors.textMuted, fontSize: 11),
      ),
      textAlign: align,
      textDirection: TextDirection.ltr,
    )..layout(minWidth: width, maxWidth: width);
    painter.paint(canvas, at);
  }

  @override
  bool shouldRepaint(_ChartPainter old) => old.s != s || old.selected != selected;
}
