/// 규격(docs/ble-protocol.md)대로 동작하는 가상 페달아이 단말과 가상 블루투스.
///
/// 실물 기판이 없어 테스트와 개발용 '가상 단말' 모드에서 쓴다. 시험 키는 시험 벡터와 같은 공개 시험용이다
/// (서버 시드의 PE-2026-000001 공개키와 짝). 실제 단말·운영에서 쓰면 안 된다.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';

import '../forensics/hash_chain.dart' show sha256;
import '../forensics/packet_codec.dart';
import '../sensor/mock_pedal_sensor_source.dart' show MockPedalGeometry;
import 'ble_protocol.dart';
import 'ble_transport.dart';

/// 시험 벡터 seed = SHA-256("PEDALEYE-TEST-DEVICE-KEY-1")
Uint8List get testDeviceSeed => sha256(utf8.encode('PEDALEYE-TEST-DEVICE-KEY-1'));

enum VirtualAuthBehavior {
  /// 규격대로 자기 키로 서명
  normal,

  /// 다른 키로 서명(위조 단말)
  wrongKey,

  /// 응답하지 않음(3초 초과)
  silent,
}

class VirtualPedalEyeDevice {
  VirtualPedalEyeDevice({
    this.serial = 'PE-2026-000001',
    Uint8List? seed,
    this.id = 'AA:BB:CC:00:00:01',
    this.protocolVersion = bleProtocolVersion,
    this.maxMtu = 247,
    this.authBehavior = VirtualAuthBehavior.normal,
    int Function()? clock,
  }) : _seed = seed ?? testDeviceSeed,
       _clock = clock ?? (() => DateTime.now().millisecondsSinceEpoch);

  final String serial;
  final String id;
  int protocolVersion;
  int maxMtu;
  VirtualAuthBehavior authBehavior;
  final Uint8List _seed;
  final int Function() _clock;

  /// 전원·광고 여부(꺼지면 검색되지 않음)
  bool advertising = true;

  /// 밟는 정도(0~1). 실시간 프레임의 거리·백분율에 반영
  double accelPress = 0;
  double brakePress = 0;

  CalibrationValues calibration = const CalibrationValues(accelMin: 0, accelMax: 4095, brakeMin: 0, brakeMax: 4095);
  int? lastTimeSyncMs;

  /// 보정 쓰기를 거부(0x85)하게 만든다(시험용)
  bool rejectCalibration = false;

  _VirtualLink? _link;
  bool get isConnected => _link != null && !_link!._closed;

  Future<Uint8List> publicKey() async {
    final pair = await Ed25519().newKeyPairFromSeed(_seed);
    return Uint8List.fromList((await pair.extractPublicKey()).bytes);
  }

  Future<Uint8List> _sign(Uint8List message) async {
    final seed = authBehavior == VirtualAuthBehavior.wrongKey ? sha256(utf8.encode('PEDALEYE-ROGUE-KEY')) : _seed;
    final pair = await Ed25519().newKeyPairFromSeed(seed);
    final signature = await Ed25519().sign(message, keyPair: pair);
    return Uint8List.fromList(signature.bytes);
  }

  /// 무선 끊김(단말 전원 차단·거리 이탈)
  void dropConnection() => _link?._close();

  PacketPayload _payload(int timestampMs) {
    int distance(int idle, int full, double press) => (idle + (full - idle) * press).round();
    final accelPercent = (accelPress * 100).round();
    final brakePercent = (brakePress * 100).round();
    return PacketPayload(
      sequenceId: 0,
      timestampMs: timestampMs,
      accelDistance: distance(MockPedalGeometry.accelIdle, MockPedalGeometry.accelFull, accelPress),
      accelPercent: accelPercent,
      brakeDistance: distance(MockPedalGeometry.brakeIdle, MockPedalGeometry.brakeFull, brakePress),
      brakePercent: brakePercent,
      bothPedal: accelPercent > 5 && brakePercent > 5,
      latitudeE7: 375665000,
      longitudeE7: 1269780000,
      speedDeciKmh: 0,
    );
  }
}

/// 가상 단말들을 품은 가상 블루투스
class VirtualBleTransport implements BleTransport {
  VirtualBleTransport({List<VirtualPedalEyeDevice>? devices, this.permission = BlePermissionResult.granted, this._adapter = BleAdapterState.on})
    : devices = devices ?? [VirtualPedalEyeDevice()];

  final List<VirtualPedalEyeDevice> devices;
  BlePermissionResult permission;
  BleAdapterState _adapter;
  final _adapterController = StreamController<BleAdapterState>.broadcast();
  int permissionRequests = 0;
  int enableRequests = 0;

  BleAdapterState get adapter => _adapter;
  set adapter(BleAdapterState value) {
    _adapter = value;
    _adapterController.add(value);
    if (value != BleAdapterState.on) {
      for (final d in devices) {
        d.dropConnection();
      }
    }
  }

  @override
  Stream<BleAdapterState> get adapterState async* {
    yield _adapter;
    yield* _adapterController.stream;
  }

  @override
  Future<BlePermissionResult> ensurePermissions() async {
    permissionRequests += 1;
    return permission;
  }

  @override
  Future<void> requestEnable() async {
    enableRequests += 1;
  }

  @override
  Future<void> openSettings() async {}

  @override
  Stream<BleAdvertisement> scan({required String serviceUuid, required Duration timeout}) async* {
    if (_adapter != BleAdapterState.on) throw const BleException('블루투스가 꺼져 있습니다.');
    if (serviceUuid != BleUuids.securityService) return;
    for (final d in devices) {
      if (d.advertising && !d.isConnected) yield BleAdvertisement(id: d.id, name: d.serial, rssi: -60);
    }
  }

  @override
  Future<BleLink> connect(String id, {Duration timeout = const Duration(seconds: 10)}) async {
    final device = devices.where((d) => d.id == id && d.advertising).firstOrNull;
    if (device == null || _adapter != BleAdapterState.on) throw const BleException('기기에 연결하지 못했습니다.');
    if (device.isConnected) throw const BleException('이미 다른 기기와 연결된 단말입니다.');
    final link = _VirtualLink(device);
    device._link = link;
    return link;
  }
}

class _VirtualLink implements BleLink {
  _VirtualLink(this.device);

  final VirtualPedalEyeDevice device;
  final _disconnected = Completer<void>();
  bool _closed = false;
  int _mtu = 23;
  bool _authenticated = false;
  final _authResponses = StreamController<Uint8List>.broadcast();
  StreamController<Uint8List>? _frames;
  Timer? _frameTimer;

  void _close() {
    if (_closed) return;
    _closed = true;
    _frameTimer?.cancel();
    unawaited(_frames?.close());
    unawaited(_authResponses.close());
    if (!_disconnected.isCompleted) _disconnected.complete();
  }

  void _ensureOpen() {
    if (_closed) throw const BleException('연결이 끊겼습니다.');
  }

  void _requireAuth() {
    if (!_authenticated) throw const BleException('인증되지 않았습니다.', code: BleErrorCodes.notAuthenticated);
  }

  @override
  Future<void> get disconnected => _disconnected.future;

  @override
  Future<int> requestMtu(int mtu) async {
    _ensureOpen();
    _mtu = mtu < device.maxMtu ? mtu : device.maxMtu;
    return _mtu;
  }

  @override
  Future<Uint8List> read(String service, String characteristic) async {
    _ensureOpen();
    if (characteristic == BleUuids.protocolVersion) {
      return (ByteData(2)..setUint16(0, device.protocolVersion, Endian.little)).buffer.asUint8List();
    }
    if (characteristic == BleUuids.serialNumber) return Uint8List.fromList(utf8.encode(device.serial));
    if (characteristic == BleUuids.firmwareVersion) return Uint8List.fromList(utf8.encode('1.0.0'));
    if (characteristic == BleUuids.hardwareRev) return Uint8List.fromList(utf8.encode('v1.0'));
    if (characteristic == BleUuids.authStatus) return Uint8List.fromList([_authenticated ? 1 : 0]);
    if (characteristic == BleUuids.calibration) {
      _requireAuth();
      return device.calibration.encode();
    }
    throw BleException('지원하지 않는 특성: $characteristic');
  }

  @override
  Future<void> write(String service, String characteristic, Uint8List data, {bool withResponse = true}) async {
    _ensureOpen();
    if (characteristic == BleUuids.authChallenge) {
      if (data.length != attestationNonceSize) throw const BleException('챌린지 길이 오류');
      if (device.authBehavior == VirtualAuthBehavior.silent) return;
      final signature = await device._sign(attestationMessage(device.serial, data));
      _authenticated = true;
      if (!_closed) _authResponses.add(signature);
      return;
    }
    if (characteristic == BleUuids.timeSync) {
      _requireAuth();
      device.lastTimeSyncMs = ByteData.sublistView(data).getUint64(0, Endian.little);
      return;
    }
    if (characteristic == BleUuids.calibration) {
      _requireAuth();
      final values = CalibrationValues.decode(data);
      if (device.rejectCalibration || values.accelMax - values.accelMin < 500 || values.brakeMax - values.brakeMin < 500) {
        throw const BleException('보정값 범위 오류', code: BleErrorCodes.invalidCalibration);
      }
      device.calibration = values;
      return;
    }
    throw BleException('지원하지 않는 특성: $characteristic');
  }

  @override
  Future<Stream<Uint8List>> subscribe(String service, String characteristic) async {
    _ensureOpen();
    if (characteristic == BleUuids.authResponse) return _authResponses.stream;
    if (characteristic == BleUuids.realtimeFrame) {
      _requireAuth();
      if (_mtu < minimumMtu) throw const BleException('MTU 가 작아 알림을 보낼 수 없습니다.');
      return _startFrames();
    }
    throw BleException('알림이 없는 특성: $characteristic');
  }

  /// 알림을 켤 때마다 순번 0, 새 체인(규격 5.1)
  Stream<Uint8List> _startFrames() {
    _frameTimer?.cancel();
    final controller = StreamController<Uint8List>(onCancel: () => _frameTimer?.cancel());
    _frames = controller;
    var seq = 0;
    Uint8List? prev;
    _frameTimer = Timer.periodic(const Duration(milliseconds: 50), (_) {
      if (_closed) return;
      final now = device._clock();
      prev ??= deviceGenesisHash(device.serial, now);
      final packet = encodePacketRecord(PacketRecord.from(device._payload(now), sequenceId: seq, prevHash: prev!));
      prev = sha256(packet);
      seq += 1;
      controller.add(packet);
    });
    return controller.stream;
  }

  @override
  Future<void> disconnect() async => _close();
}
