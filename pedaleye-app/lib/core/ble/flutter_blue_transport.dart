/// 실제 블루투스(Android). flutter_blue_plus 를 BleTransport 로 감싼다.
library;

import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:permission_handler/permission_handler.dart';

import 'ble_transport.dart';

class FlutterBlueTransport implements BleTransport {
  @override
  Stream<BleAdapterState> get adapterState => FlutterBluePlus.adapterState.map(
    (s) => switch (s) {
      BluetoothAdapterState.on => BleAdapterState.on,
      BluetoothAdapterState.off || BluetoothAdapterState.turningOff || BluetoothAdapterState.turningOn => BleAdapterState.off,
      BluetoothAdapterState.unavailable || BluetoothAdapterState.unauthorized => BleAdapterState.unavailable,
      _ => BleAdapterState.unknown,
    },
  );

  /// Android 12(API 31) 이상: 근처 기기 권한(검색·연결). 11 이하: 위치 권한(BLE 검색에 필요)
  @override
  Future<BlePermissionResult> ensurePermissions() async {
    if (!Platform.isAndroid) return BlePermissionResult.granted;
    final sdk = (await DeviceInfoPlugin().androidInfo).version.sdkInt;
    final permissions = sdk >= 31 ? [Permission.bluetoothScan, Permission.bluetoothConnect] : [Permission.locationWhenInUse];
    final statuses = await permissions.request();
    if (statuses.values.every((s) => s.isGranted)) return BlePermissionResult.granted;
    return statuses.values.any((s) => s.isPermanentlyDenied) ? BlePermissionResult.permanentlyDenied : BlePermissionResult.denied;
  }

  @override
  Future<void> requestEnable() async {
    if (!Platform.isAndroid) return;
    try {
      await FlutterBluePlus.turnOn();
    } on FlutterBluePlusException {
      // 사용자가 거절
    }
  }

  @override
  Future<void> openSettings() async {
    await openAppSettings();
  }

  @override
  Stream<BleAdvertisement> scan({required String serviceUuid, required Duration timeout}) async* {
    final seen = <String>{};
    final results = StreamController<BleAdvertisement>();
    final subscription = FlutterBluePlus.onScanResults.listen((list) {
      for (final r in list) {
        final id = r.device.remoteId.str;
        if (seen.add(id)) results.add(BleAdvertisement(id: id, name: r.advertisementData.advName, rssi: r.rssi));
      }
    });
    Future<void>? done;
    try {
      await FlutterBluePlus.startScan(withServices: [Guid(serviceUuid)], timeout: timeout);
      // 검색 시간이 끝나면(또는 멈추면) 결과 스트림을 닫는다. 시작한 뒤에 구독해야 '아직 시작 전' 값을 받지 않는다
      done = FlutterBluePlus.isScanning.where((scanning) => !scanning).first.then((_) => results.close());
      yield* results.stream;
    } on FlutterBluePlusException catch (error) {
      throw BleException('검색 실패: ${error.description}', code: error.code);
    } finally {
      await subscription.cancel();
      if (done != null) unawaited(done);
      if (FlutterBluePlus.isScanningNow) await FlutterBluePlus.stopScan();
    }
  }

  @override
  Future<BleLink> connect(String id, {Duration timeout = const Duration(seconds: 10)}) async {
    final device = BluetoothDevice.fromId(id);
    try {
      await device.connect(timeout: timeout, mtu: null);
      final services = await device.discoverServices();
      return _FlutterBlueLink(device, services);
    } on FlutterBluePlusException catch (error) {
      await device.disconnect();
      throw BleException('연결 실패: ${error.description}', code: error.code);
    } on TimeoutException {
      await device.disconnect();
      throw const BleException('연결 시간 초과');
    }
  }
}

class _FlutterBlueLink implements BleLink {
  _FlutterBlueLink(this._device, this._services) {
    _connectionSubscription = _device.connectionState.listen((state) {
      if (state == BluetoothConnectionState.disconnected && !_disconnected.isCompleted) {
        _disconnected.complete();
        unawaited(_connectionSubscription?.cancel());
      }
    });
  }

  final BluetoothDevice _device;
  final List<BluetoothService> _services;
  final _disconnected = Completer<void>();
  StreamSubscription<BluetoothConnectionState>? _connectionSubscription;

  BluetoothCharacteristic _characteristic(String service, String characteristic) {
    final s = _services.where((x) => x.uuid == Guid(service)).firstOrNull;
    final c = s?.characteristics.where((x) => x.uuid == Guid(characteristic)).firstOrNull;
    if (c == null) throw BleException('단말에 특성이 없습니다: $characteristic');
    return c;
  }

  Future<T> _guard<T>(Future<T> Function() action) async {
    try {
      return await action();
    } on FlutterBluePlusException catch (error) {
      throw BleException(error.description ?? '블루투스 오류', code: error.code);
    } on TimeoutException {
      throw const BleException('응답 시간 초과');
    }
  }

  @override
  Future<void> get disconnected => _disconnected.future;

  @override
  Future<int> requestMtu(int mtu) => _guard(() => _device.requestMtu(mtu));

  @override
  Future<Uint8List> read(String service, String characteristic) =>
      _guard(() async => Uint8List.fromList(await _characteristic(service, characteristic).read()));

  @override
  Future<void> write(String service, String characteristic, Uint8List data, {bool withResponse = true}) =>
      _guard(() => _characteristic(service, characteristic).write(data, withoutResponse: !withResponse));

  @override
  Future<Stream<Uint8List>> subscribe(String service, String characteristic) => _guard(() async {
    final c = _characteristic(service, characteristic);
    final controller = StreamController<Uint8List>();
    final subscription = c.onValueReceived.listen((v) => controller.add(Uint8List.fromList(v)), onError: controller.addError);
    _device.cancelWhenDisconnected(subscription);
    controller.onCancel = () async {
      await subscription.cancel();
      if (_device.isConnected) {
        try {
          await c.setNotifyValue(false);
        } on FlutterBluePlusException {
          // 이미 끊김
        }
      }
    };
    // 암호화가 필요한 특성은 여기서 OS 가 페어링(LE Secure Connections)을 진행한다
    await c.setNotifyValue(true);
    return controller.stream;
  });

  @override
  Future<void> disconnect() async {
    try {
      await _device.disconnect();
    } on FlutterBluePlusException {
      // 이미 끊김
    }
    if (!_disconnected.isCompleted) _disconnected.complete();
  }
}
