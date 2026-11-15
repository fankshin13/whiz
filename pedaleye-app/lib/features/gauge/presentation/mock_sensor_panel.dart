import 'package:material_ui/material_ui.dart';

import '../../../core/sensor/mock_pedal_sensor_source.dart';
import '../../../core/theme/app_theme.dart';

const _scenarioLabels = {
  MockPedalScenario.manual: '직접 조작',
  MockPedalScenario.normalDrive: '정상 주행',
  MockPedalScenario.suddenAccel: '급가속',
  MockPedalScenario.suddenBrake: '급제동',
  MockPedalScenario.dualPedalWarning: '양발 조작',
  MockPedalScenario.sensorTimeout: '신호 끊김',
};

/// 실물 단말이 없을 때 쓰는 모의 센서 조작판. 실제 센서(BLE)에서는 나타나지 않는다.
class MockSensorPanel extends StatefulWidget {
  const MockSensorPanel({super.key, required this.source, this.showScenarios = false});

  final MockPedalSensorSource source;
  final bool showScenarios;

  @override
  State<MockSensorPanel> createState() => _MockSensorPanelState();
}

class _MockSensorPanelState extends State<MockSensorPanel> {
  double _accel = 0;
  double _brake = 0;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final scenario = widget.source.scenario;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.s4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const Icon(Icons.science_outlined, size: 20, color: AppColors.textMuted),
                const SizedBox(width: AppSpacing.s2),
                Expanded(child: Text('모의 센서', style: text.titleMedium)),
              ],
            ),
            const SizedBox(height: AppSpacing.s1),
            Text('실물 단말 연결 전 시험용입니다. 실제 주행 값이 아닙니다.', style: text.bodySmall),
            if (widget.showScenarios) ...[
              const SizedBox(height: AppSpacing.s3),
              Wrap(
                spacing: AppSpacing.s2,
                runSpacing: AppSpacing.s2,
                children: [
                  for (final entry in _scenarioLabels.entries)
                    ChoiceChip(
                      label: Text(entry.value),
                      selected: scenario == entry.key,
                      onSelected: (_) => setState(() => widget.source.setScenario(entry.key)),
                    ),
                ],
              ),
            ],
            if (scenario == MockPedalScenario.manual) ...[
              const SizedBox(height: AppSpacing.s3),
              _PressSlider(
                label: '가속 페달 밟기',
                value: _accel,
                color: AppColors.accel,
                onChanged: (v) => setState(() {
                  _accel = v;
                  widget.source.setPress(accel: v);
                }),
              ),
              _PressSlider(
                label: '제동 페달 밟기',
                value: _brake,
                color: AppColors.brake,
                onChanged: (v) => setState(() {
                  _brake = v;
                  widget.source.setPress(brake: v);
                }),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _PressSlider extends StatelessWidget {
  const _PressSlider({required this.label, required this.value, required this.color, required this.onChanged});

  final String label;
  final double value;
  final Color color;
  final ValueChanged<double> onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('$label ${(value * 100).round()}%', style: Theme.of(context).textTheme.bodyMedium),
        Slider(
          value: value,
          onChanged: onChanged,
          activeColor: color,
          semanticFormatterCallback: (v) => '${(v * 100).round()}%',
          label: label,
        ),
      ],
    );
  }
}
