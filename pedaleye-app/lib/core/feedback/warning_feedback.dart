import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// 양발 동시 조작 때 화면 밖으로 알리는 신호(진동·경고음). 테스트에서는 가짜로 바꾼다.
abstract interface class WarningFeedback {
  Future<void> dualPressPulse();
}

class DeviceWarningFeedback implements WarningFeedback {
  /// Flutter 기본 경고음(SystemSoundType.alert)은 Android 에서 지원되지 않아 MainActivity 의 ToneGenerator 를 쓴다
  static const _channel = MethodChannel('kr.pedaleye/alert');

  @override
  Future<void> dualPressPulse() async {
    await HapticFeedback.heavyImpact();
    try {
      await _channel.invokeMethod<void>('beep');
    } on PlatformException catch (error) {
      // 진동과 화면 경고는 그대로 동작한다. 경고음만 빠진 상태를 개발 로그에 남긴다.
      debugPrint('경고음 재생 실패: ${error.code}');
    } on MissingPluginException {
      debugPrint('경고음 채널 없음(Android 외 환경)');
    }
  }
}
