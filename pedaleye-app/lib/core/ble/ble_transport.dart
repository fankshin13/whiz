/// 저수준 BLE 입출력. 실제 블루투스(flutter_blue_plus)와 가상 단말(시험·개발용)이 같은 인터페이스를 구현해
/// 연결·인증 로직(DeviceLinkController)이 하드웨어 없이도 그대로 시험되게 한다.
library;

import 'dart:typed_data';

enum BleAdapterState { unknown, unavailable, off, on }

enum BlePermissionResult {
  granted,

  /// 이번에 거부(다시 물어볼 수 있음)
  denied,

  /// '다시 묻지 않음' 등으로 영구 거부 → 앱 설정에서 허용해야 함
  permanentlyDenied,
}

/// 검색으로 찾은 기기
class BleAdvertisement {
  const BleAdvertisement({required this.id, required this.name, this.rssi});

  /// 플랫폼 기기 식별자(Android 는 MAC 주소)
  final String id;

  /// 광고 이름. 페달아이 단말은 일련번호
  final String name;
  final int? rssi;
}

class BleException implements Exception {
  const BleException(this.message, {this.code});
  final String message;

  /// 단말이 돌려준 ATT 오류 코드(있으면)
  final int? code;
  @override
  String toString() => 'BleException($message${code == null ? '' : ', 0x${code!.toRadixString(16)}'})';
}

abstract interface class BleTransport {
  Stream<BleAdapterState> get adapterState;

  /// 검색·연결에 필요한 권한을 확인하고 없으면 요청한다
  Future<BlePermissionResult> ensurePermissions();

  /// 시스템 블루투스 켜기 요청(Android). 지원하지 않으면 아무것도 하지 않는다
  Future<void> requestEnable();

  /// 앱 설정 화면 열기(권한 영구 거부 시)
  Future<void> openSettings();

  /// [serviceUuid] 를 광고하는 기기를 [timeout] 동안 찾는다(찾을 때마다 흘려보냄)
  Stream<BleAdvertisement> scan({required String serviceUuid, required Duration timeout});

  Future<BleLink> connect(String id, {Duration timeout = const Duration(seconds: 10)});
}

/// 연결된 단말 하나. 특성은 (서비스 UUID, 특성 UUID) 로 가리킨다.
abstract interface class BleLink {
  /// 연결이 끊기면 완료된다(한 번)
  Future<void> get disconnected;

  /// 협상된 ATT MTU
  Future<int> requestMtu(int mtu);

  Future<Uint8List> read(String service, String characteristic);

  Future<void> write(String service, String characteristic, Uint8List data, {bool withResponse = true});

  /// 알림을 켜고(CCCD) 완료되면 값 스트림을 돌려준다. 스트림을 취소하면 알림을 끈다
  Future<Stream<Uint8List>> subscribe(String service, String characteristic);

  Future<void> disconnect();
}
