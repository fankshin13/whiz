import 'package:material_ui/material_ui.dart';

import '../../../app_scope.dart';
import '../../../core/ble/virtual_pedaleye_device.dart';
import '../../../core/text/keep_all.dart';
import '../../../core/widgets/screen_body.dart';
import '../data/sensor_mode_store.dart';

const _labels = {
  SensorMode.mock: ('모의 센서', '앱 안의 슬라이더로 페달을 흉내 냅니다(단말 없이 연습).'),
  SensorMode.ble: ('BLE 단말', '블루투스로 배정된 페달아이 단말에 연결합니다.'),
  SensorMode.virtual: ('가상 단말(개발용)', '블루투스 없이 규격대로 동작하는 가상 단말로 연결·인증 흐름을 확인합니다.'),
};

/// 개발 설정: 페달 데이터를 어디서 받을지 고른다(앱을 다시 켜도 유지)
class SensorSettingsScreen extends StatelessWidget {
  const SensorSettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final store = AppScope.of(context).sensorMode;
    return Scaffold(
      appBar: AppBar(title: const Text('센서 설정(개발용)')),
      body: store == null
          ? const Center(child: Text('이 빌드에서는 센서를 바꿀 수 없습니다.'))
          : ListenableBuilder(
              listenable: store,
              builder: (context, _) => ScreenBody(
                children: [
                  Text(keepAll('실물 단말이 준비되기 전 개발·시험용 설정입니다. 실제 운행에서는 BLE 단말을 쓰세요.'),
                      style: Theme.of(context).textTheme.bodyMedium),
                  const SizedBox(height: 12),
                  if (store.mode == SensorMode.virtual && AppScope.of(context).virtualDevice != null) ...[
                    const _VirtualDeviceControls(),
                    const SizedBox(height: 12),
                  ],
                  RadioGroup<SensorMode>(
                    groupValue: store.mode,
                    onChanged: (mode) {
                      if (mode != null) store.setMode(mode);
                    },
                    child: Column(
                      children: [
                        for (final mode in SensorMode.values)
                          RadioListTile<SensorMode>(
                            value: mode,
                            title: Text(_labels[mode]!.$1),
                            subtitle: Text(keepAll(_labels[mode]!.$2)),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

/// 가상 단말 시뮬레이터: 사고 기록 만들기와 장애 주입(개발·시험용)
class _VirtualDeviceControls extends StatefulWidget {
  const _VirtualDeviceControls();

  @override
  State<_VirtualDeviceControls> createState() => _VirtualDeviceControlsState();
}

class _VirtualDeviceControlsState extends State<_VirtualDeviceControls> {
  bool _busy = false;

  Future<void> _record({bool tamper = false}) async {
    final scope = AppScope.of(context);
    setState(() => _busy = true);
    await scope.virtualDevice!.recordSession(tamper: tamper);
    if (!mounted) return;
    setState(() => _busy = false);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tamper ? '변조된 사고 기록을 단말에 넣었습니다.' : '60초 급제동 사고 기록을 단말에 넣었습니다.')));
    await scope.deviceLogSync?.syncNow();
    if (mounted) setState(() {});
  }

  void _inject(String label, void Function(VirtualPedalEyeDevice device) apply) {
    apply(AppScope.of(context).virtualDevice!);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(label)));
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final device = AppScope.of(context).virtualDevice!;
    final archived = device.sessions.where((s) => s.archived).length;
    final text = Theme.of(context).textTheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('가상 단말 시뮬레이터', style: text.titleSmall),
            const SizedBox(height: 4),
            Text(keepAll('단말 ${device.serial} · 보관 기록 ${device.sessions.length}건(보관 완료 $archived건)'), style: text.bodySmall),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton(onPressed: _busy ? null : _record, child: const Text('60초 급제동 기록 만들기')),
                OutlinedButton(onPressed: _busy ? null : () => _record(tamper: true), child: const Text('변조 기록(1비트) 만들기')),
                OutlinedButton(onPressed: () => _inject('다음 전송 50%에서 연결이 끊깁니다.', (d) => d.disconnectAtFraction = 0.5), child: const Text('전송 50%에서 끊기')),
                OutlinedButton(onPressed: () => _inject('청크 10번을 한 번 유실시킵니다.', (d) => d.dropChunkOnce = 10), child: const Text('청크 유실')),
                OutlinedButton(onPressed: () => _inject('청크 20번을 한 번 손상시킵니다.', (d) => d.corruptChunkOnce = 20), child: const Text('청크 손상')),
                OutlinedButton(onPressed: () => _inject('무선 연결을 끊었습니다.', (d) => d.dropConnection()), child: const Text('연결 끊기')),
                OutlinedButton(
                  onPressed: () => _inject(
                    device.authBehavior == VirtualAuthBehavior.wrongKey ? '정품 단말로 되돌렸습니다.' : '위조 단말(다른 키)로 바꿨습니다. 다시 연결하면 인증 실패합니다.',
                    (d) => d.authBehavior = d.authBehavior == VirtualAuthBehavior.wrongKey ? VirtualAuthBehavior.normal : VirtualAuthBehavior.wrongKey,
                  ),
                  child: Text(device.authBehavior == VirtualAuthBehavior.wrongKey ? '정품 단말로' : '위조 단말로'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
