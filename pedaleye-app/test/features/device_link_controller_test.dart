import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:pedaleye_app/core/ble/ble_protocol.dart';
import 'package:pedaleye_app/core/ble/ble_transport.dart';
import 'package:pedaleye_app/core/ble/virtual_pedaleye_device.dart';
import 'package:pedaleye_app/features/calibration/domain/driver_device.dart';
import 'package:pedaleye_app/features/device/application/device_link_controller.dart';

import '../fakes.dart';

// 가상 단말(규격대로 서명·알림)로 연결·인증·실시간·끊김·보정 흐름을 확인한다
DriverDevice withKey(Uint8List? key, {String serial = 'PE-2026-000001'}) => DriverDevice(
  deviceId: calibratedDevice.deviceId,
  serialNumber: serial,
  plateNumber: calibratedDevice.plateNumber,
  calibration: calibratedDevice.calibration,
  authPublicKey: key,
);

Future<void> until(bool Function() condition, {Duration timeout = const Duration(seconds: 3)}) async {
  final end = DateTime.now().add(timeout);
  while (!condition()) {
    if (DateTime.now().isAfter(end)) throw TimeoutException('조건을 기다리다 시간 초과');
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
}

void main() {
  late VirtualPedalEyeDevice device;
  late Uint8List key;

  setUp(() async {
    device = VirtualPedalEyeDevice();
    key = await device.publicKey();
  });

  DeviceLinkController controller(VirtualBleTransport transport, DriverDevice? assigned, {Duration authTimeout = const Duration(seconds: 3)}) =>
      DeviceLinkController(
        transport: transport,
        devices: FakeDeviceRepository(assigned),
        currentUserId: () => driverId,
        delay: (_) => Future<void>.delayed(const Duration(milliseconds: 10)),
        authTimeout: authTimeout,
      );

  test('배정 단말만 골라 연결·인증하고, 실시간 프레임을 받는다(다른 차량 단말은 건너뜀)', () async {
    final other = VirtualPedalEyeDevice(serial: 'PE-2026-000003', id: 'AA:BB:CC:00:00:03');
    final transport = VirtualBleTransport(devices: [other, device]);
    final link = controller(transport, withKey(key))..start();
    await until(() => link.status == DeviceLinkStatus.connected);
    expect(other.isConnected, isFalse);
    expect(link.otherDevicesSeen, 1);
    expect(device.lastTimeSyncMs, isNotNull);

    device.accelPress = 1;
    final frame = await link.frames.firstWhere((f) => f.record.accelPercent == 100);
    expect(frame.record.accelDistance, 8050);
    final frames = await link.frames.take(5).toList();
    expect(frames.map((f) => f.record.sequenceId).toList(), [for (var i = 0; i < 5; i++) frames.first.record.sequenceId + i]);
    expect(link.chainErrors, 0);
    await link.stop();
    expect(device.isConnected, isFalse);
  });

  test('다른 키로 서명한 단말(위조)은 연결을 끊고 인증 실패, 자동 재시도하지 않는다', () async {
    device.authBehavior = VirtualAuthBehavior.wrongKey;
    final link = controller(VirtualBleTransport(devices: [device]), withKey(key))..start();
    await until(() => link.status == DeviceLinkStatus.authFailed);
    expect(device.isConnected, isFalse);
    await Future<void>.delayed(const Duration(milliseconds: 100));
    expect(link.status, DeviceLinkStatus.authFailed);

    device.authBehavior = VirtualAuthBehavior.normal; // 운전자가 다시 시도
    link.retry();
    await until(() => link.status == DeviceLinkStatus.connected);
    await link.stop();
  });

  test('응답 없는 단말·일련번호를 속인 단말도 인증 실패', () async {
    device.authBehavior = VirtualAuthBehavior.silent;
    final silent = controller(VirtualBleTransport(devices: [device]), withKey(key), authTimeout: const Duration(milliseconds: 100))..start();
    await until(() => silent.status == DeviceLinkStatus.authFailed);
    await silent.stop();

    // 광고 이름은 배정 일련번호인데 단말이 읽어 준 일련번호가 다름 → 서명 대상도 달라 거부
    final liar = VirtualPedalEyeDevice(serial: 'PE-2026-000009');
    final transport = VirtualBleTransport(devices: [liar]);
    final link = controller(transport, withKey(await liar.publicKey(), serial: 'PE-2026-000009'));
    final spoofTransport = _RenamingTransport(transport, advertisedName: 'PE-2026-000001');
    final spoof = DeviceLinkController(
      transport: spoofTransport,
      devices: FakeDeviceRepository(withKey(key)),
      currentUserId: () => driverId,
      delay: (_) => Future<void>.delayed(const Duration(milliseconds: 10)),
    )..start();
    await until(() => spoof.status == DeviceLinkStatus.authFailed);
    await spoof.stop();
    link.dispose();
  });

  test('끊기면 disconnected 를 거쳐 자동으로 다시 연결·재인증한다', () async {
    final link = controller(VirtualBleTransport(devices: [device]), withKey(key))..start();
    await until(() => link.status == DeviceLinkStatus.connected);
    final seen = <DeviceLinkStatus>[];
    link.addListener(() => seen.add(link.status));
    device.dropConnection();
    await until(() => seen.contains(DeviceLinkStatus.disconnected) && link.status == DeviceLinkStatus.connected);
    expect(seen, containsAllInOrder([DeviceLinkStatus.disconnected, DeviceLinkStatus.authenticating, DeviceLinkStatus.connected]));

    // 단말 전원이 꺼진 동안은 찾는 중
    device.advertising = false;
    device.dropConnection();
    await until(() => link.status == DeviceLinkStatus.notFound);
    device.advertising = true;
    await until(() => link.status == DeviceLinkStatus.connected);
    await link.stop();
  });

  test('권한 거부·블루투스 꺼짐·배정 없음·MTU 부족·규격 버전 다름을 상태로 알린다', () async {
    final denied = controller(VirtualBleTransport(devices: [device], permission: BlePermissionResult.permanentlyDenied), withKey(key))..start();
    await until(() => denied.status == DeviceLinkStatus.permissionPermanentlyDenied);
    await denied.stop();

    final transport = VirtualBleTransport(devices: [device], adapter: BleAdapterState.off);
    final off = controller(transport, withKey(key))..start();
    await until(() => off.status == DeviceLinkStatus.bluetoothOff);
    transport.adapter = BleAdapterState.on; // 사용자가 블루투스를 켬
    await until(() => off.status == DeviceLinkStatus.connected);
    await off.stop();

    final none = controller(VirtualBleTransport(devices: [device]), null)..start();
    await until(() => none.status == DeviceLinkStatus.unassigned);
    await none.stop();

    device.maxMtu = 23;
    final mtu = controller(VirtualBleTransport(devices: [device]), withKey(key))..start();
    await until(() => mtu.status == DeviceLinkStatus.incompatiblePhone);
    await mtu.stop();

    device
      ..maxMtu = 247
      ..protocolVersion = 0x0200;
    final version = controller(VirtualBleTransport(devices: [device]), withKey(key))..start();
    await until(() => version.status == DeviceLinkStatus.unsupportedVersion);
    await version.stop();
  });

  test('공개키 미등록(시험) 단말은 운전자 동의 후에만 연결한다', () async {
    final link = controller(VirtualBleTransport(devices: [device]), withKey(null))..start();
    await until(() => link.status == DeviceLinkStatus.testDeviceConsentRequired);
    expect(device.isConnected, isFalse);
    link.acceptTestDevice();
    await until(() => link.status == DeviceLinkStatus.connected);
    await link.stop();
  });

  test('보정값은 연결·인증된 단말에 쓰고, 끊겼거나 거부되면 오류', () async {
    final link = controller(VirtualBleTransport(devices: [device]), withKey(key));
    const values = CalibrationValues(accelMin: 8050, accelMax: 12050, brakeMin: 9500, brakeMax: 13000);
    await expectLater(link.writeCalibration(values), throwsA(isA<CalibrationWriteException>()));
    link.start();
    await until(() => link.status == DeviceLinkStatus.connected);
    await link.writeCalibration(values);
    expect(device.calibration.encode(), values.encode());

    device.rejectCalibration = true;
    await expectLater(
      link.writeCalibration(values),
      throwsA(isA<CalibrationWriteException>().having((e) => e.message, 'message', contains('5mm'))),
    );
    await link.stop();
  });
}

/// 광고 이름만 바꿔 다른 단말인 척하는 전송(시험용)
class _RenamingTransport implements BleTransport {
  _RenamingTransport(this._inner, {required this.advertisedName});
  final BleTransport _inner;
  final String advertisedName;

  @override
  Stream<BleAdapterState> get adapterState => _inner.adapterState;
  @override
  Future<BlePermissionResult> ensurePermissions() => _inner.ensurePermissions();
  @override
  Future<void> requestEnable() => _inner.requestEnable();
  @override
  Future<void> openSettings() => _inner.openSettings();
  @override
  Stream<BleAdvertisement> scan({required String serviceUuid, required Duration timeout}) =>
      _inner.scan(serviceUuid: serviceUuid, timeout: timeout).map((ad) => BleAdvertisement(id: ad.id, name: advertisedName));
  @override
  Future<BleLink> connect(String id, {Duration timeout = const Duration(seconds: 10)}) => _inner.connect(id, timeout: timeout);
}
