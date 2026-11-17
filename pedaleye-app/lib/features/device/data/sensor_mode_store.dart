import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

/// 페달 데이터를 어디서 받을지(개발 설정). 실물 단말이 나오기 전 기본값은 모의 센서.
enum SensorMode {
  /// 앱 안의 모의 센서(화면 슬라이더)
  mock,

  /// 실제 블루투스로 페달아이 단말
  ble,

  /// 규격대로 동작하는 가상 단말(블루투스 없이 연결·인증 흐름 확인)
  virtual,
}

/// 선택한 센서 방식을 앱 문서 폴더의 작은 파일에 저장한다(앱을 다시 켜도 유지).
class SensorModeStore extends ChangeNotifier {
  SensorModeStore(this._file, {SensorMode initial = SensorMode.mock}) : _mode = initial;

  final File? _file;
  SensorMode _mode;

  SensorMode get mode => _mode;

  static Future<SensorModeStore> load(File file) async {
    var mode = SensorMode.mock;
    try {
      if (await file.exists()) {
        final value = (jsonDecode(await file.readAsString()) as Map<String, dynamic>)['sensorMode'];
        mode = SensorMode.values.firstWhere((m) => m.name == value, orElse: () => SensorMode.mock);
      }
    } on Object {
      mode = SensorMode.mock; // 깨진 설정은 기본값
    }
    return SensorModeStore(file, initial: mode);
  }

  Future<void> setMode(SensorMode mode) async {
    if (_mode == mode) return;
    _mode = mode;
    notifyListeners();
    final file = _file;
    if (file != null) {
      await file.parent.create(recursive: true);
      await file.writeAsString(jsonEncode({'sensorMode': mode.name}));
    }
  }
}
