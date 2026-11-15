import 'package:connectivity_plus/connectivity_plus.dart' as plus;

import '../../features/events/application/event_sync_controller.dart';

/// connectivity_plus 로 휴대폰의 네트워크 연결(와이파이·모바일 데이터) 변화를 알린다.
/// 비행기 모드면 none. 연결돼도 서버에 닿는지는 업로드 시도로 판단한다.
class DeviceConnectivity implements Connectivity {
  final _plugin = plus.Connectivity();

  static bool _online(List<plus.ConnectivityResult> results) => results.any((r) => r != plus.ConnectivityResult.none);

  @override
  Future<bool> isOnline() async => _online(await _plugin.checkConnectivity());

  @override
  Stream<bool> get onlineChanges => _plugin.onConnectivityChanged.map(_online).distinct();
}
