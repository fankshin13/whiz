import 'package:material_ui/material_ui.dart';

import '../../../app_scope.dart';
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
