/// 배정 단말과의 BLE 연결·인증·실시간 프레임 수신을 맡는다(docs/ble-protocol.md 4장).
///
/// 순서: 권한 → 블루투스 켜짐 → 배정 단말 조회(일련번호·공개키) → 검색(일련번호 일치만) → 연결 →
/// MTU(≥67) → 규격 버전 → 일련번호 확인 → 챌린지 서명 검증(3초) → 시각 동기화 → 실시간 알림.
/// 끊기면 1·2·4·8·10초 간격으로 다시 연결하고 매번 다시 인증한다. 인증 실패는 자동으로 다시 시도하지 않는다.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/foundation.dart';

import '../../../core/ble/ble_protocol.dart';
import '../../../core/ble/ble_transport.dart';
import '../../../core/forensics/hash_chain.dart' show sha256;
import '../../../core/forensics/packet_codec.dart';
import '../../calibration/data/device_repository.dart';
import '../../calibration/domain/driver_device.dart';

enum DeviceLinkStatus {
  idle,
  checkingPermission,
  permissionDenied,
  permissionPermanentlyDenied,
  bluetoothOff,
  loadingDevice,
  deviceLoadFailed,

  /// 배정 차량·단말 없음
  unassigned,

  /// 공개키 미등록(시험 단말): 운전자 확인 후에만 연결
  testDeviceConsentRequired,
  scanning,

  /// 검색 시간 안에 배정 단말을 못 찾음(다시 찾는 중)
  notFound,
  connecting,
  authenticating,
  connected,

  /// 서명 불일치·일련번호 불일치·응답 없음 → 연결 해제, 자동 재시도 없음
  authFailed,

  /// 휴대폰이 MTU 67 이상을 지원하지 않음
  incompatiblePhone,

  /// 단말 규격 주 버전이 다름
  unsupportedVersion,

  /// 연결이 끊김(다시 연결 중)
  disconnected,
}

/// 실시간 프레임 하나(64바이트 패킷 해석 결과)
class RealtimeFrame {
  const RealtimeFrame(this.record);
  final PacketRecord record;
}

class CalibrationWriteException implements Exception {
  const CalibrationWriteException(this.message);
  final String message;
}

typedef DelayFn = Future<void> Function(Duration duration);

class DeviceLinkController extends ChangeNotifier {
  DeviceLinkController({
    required this._transport,
    required this._devices,
    required this._currentUserId,
    DelayFn? delay,
    Random? random,
    this.scanTimeout = const Duration(seconds: 10),
    this.authTimeout = const Duration(seconds: 3),
  }) : _delay = delay ?? Future<void>.delayed,
       _random = random ?? Random.secure();

  BleTransport _transport;
  final DeviceRepository _devices;
  final String? Function() _currentUserId;
  final DelayFn _delay;
  final Random _random;
  final Duration scanTimeout;
  final Duration authTimeout;

  static const reconnectDelays = [Duration(seconds: 1), Duration(seconds: 2), Duration(seconds: 4), Duration(seconds: 8), Duration(seconds: 10)];

  DeviceLinkStatus _status = DeviceLinkStatus.idle;
  DriverDevice? _device;
  BleLink? _link;
  int _generation = 0;
  bool _running = false;
  final Set<String> _consentedTestSerials = {};
  Completer<void>? _wake;
  StreamSubscription<Uint8List>? _frameSubscription;
  final _frames = StreamController<RealtimeFrame>.broadcast();
  int _lastSeq = -1;
  Uint8List? _lastHash;

  /// 무선 유실로 건너뛴 프레임 수, 체인이 맞지 않은 프레임 수(화면 표시용 진단)
  int lostFrames = 0;
  int chainErrors = 0;

  /// 검색에서 본 다른(배정 아닌) 단말 수
  int otherDevicesSeen = 0;

  DeviceLinkStatus get status => _status;
  DriverDevice? get device => _device;
  bool get isConnected => _status == DeviceLinkStatus.connected;
  Stream<RealtimeFrame> get frames => _frames.stream;

  /// 가상 단말 ↔ 실제 블루투스 전환(개발 설정)
  Future<void> replaceTransport(BleTransport transport) async {
    final wasRunning = _running;
    await stop();
    _transport = transport;
    if (wasRunning) start();
  }

  void start() {
    if (_running) return;
    _running = true;
    unawaited(_run(++_generation));
  }

  Future<void> stop() async {
    _running = false;
    _generation += 1;
    _wakeUp();
    await _closeLink();
    _device = null;
    _set(DeviceLinkStatus.idle);
  }

  /// 권한·블루투스·인증 실패 등에서 운전자가 '다시 시도'를 누름
  void retry() {
    if (!_running) return start();
    _generation += 1;
    _wakeUp();
    unawaited(_closeLink().then((_) => _run(_generation)));
  }

  /// 공개키 미등록(시험) 단말 연결에 동의
  void acceptTestDevice() {
    final serial = _device?.serialNumber;
    if (serial == null) return;
    _consentedTestSerials.add(serial);
    retry();
  }

  Future<void> requestEnableBluetooth() => _transport.requestEnable();
  Future<void> openSettings() => _transport.openSettings();

  bool _alive(int generation) => _running && generation == _generation;

  void _set(DeviceLinkStatus next) {
    if (_status == next) return;
    _status = next;
    notifyListeners();
  }

  void _wakeUp() {
    final wake = _wake;
    _wake = null;
    if (wake != null && !wake.isCompleted) wake.complete();
  }

  /// 운전자 조작(retry)을 기다린다
  Future<void> _waitForUser() {
    final wake = Completer<void>();
    _wake = wake;
    return wake.future;
  }

  Future<void> _run(int generation) async {
    var attempt = 0;
    while (_alive(generation)) {
      // 1) 권한
      _set(DeviceLinkStatus.checkingPermission);
      final permission = await _transport.ensurePermissions();
      if (!_alive(generation)) return;
      if (permission != BlePermissionResult.granted) {
        _set(permission == BlePermissionResult.permanentlyDenied ? DeviceLinkStatus.permissionPermanentlyDenied : DeviceLinkStatus.permissionDenied);
        return _waitForUser();
      }

      // 2) 블루투스 켜짐
      final adapter = await _transport.adapterState.firstWhere((s) => s != BleAdapterState.unknown);
      if (!_alive(generation)) return;
      if (adapter != BleAdapterState.on) {
        _set(DeviceLinkStatus.bluetoothOff);
        await _transport.adapterState.firstWhere((s) => s == BleAdapterState.on || !_alive(generation));
        continue;
      }

      // 3) 배정 단말(일련번호·공개키)
      if (_device == null) {
        _set(DeviceLinkStatus.loadingDevice);
        final userId = _currentUserId();
        try {
          _device = userId == null ? null : await _devices.loadMyDevice(userId);
        } on DeviceLoadException {
          if (!_alive(generation)) return;
          _set(DeviceLinkStatus.deviceLoadFailed);
          return _waitForUser();
        }
        if (!_alive(generation)) return;
        if (_device == null) {
          _set(DeviceLinkStatus.unassigned);
          return _waitForUser();
        }
      }
      final device = _device!;
      if (!device.hasAuthKey && !_consentedTestSerials.contains(device.serialNumber)) {
        _set(DeviceLinkStatus.testDeviceConsentRequired);
        return _waitForUser();
      }

      // 4) 검색 → 연결 → 인증 → 실시간
      final outcome = await _connectOnce(generation, device);
      if (!_alive(generation)) return;
      switch (outcome) {
        case _Outcome.stopForUser:
          return _waitForUser();
        case _Outcome.connected:
          attempt = 0;
          await _link?.disconnected;
          if (!_alive(generation)) return;
          await _closeLink();
          _set(DeviceLinkStatus.disconnected);
        case _Outcome.retry:
          break;
      }
      final wait = reconnectDelays[min(attempt, reconnectDelays.length - 1)];
      attempt += 1;
      await _delay(wait);
    }
  }

  Future<_Outcome> _connectOnce(int generation, DriverDevice device) async {
    _set(DeviceLinkStatus.scanning);
    BleAdvertisement? found;
    otherDevicesSeen = 0;
    try {
      await for (final ad in _transport.scan(serviceUuid: BleUuids.securityService, timeout: scanTimeout)) {
        if (!_alive(generation)) return _Outcome.retry;
        // 배정 단말(일련번호 일치)만. 다른 차량 단말은 건너뛴다
        if (ad.name == device.serialNumber) {
          found = ad;
          break;
        }
        otherDevicesSeen += 1;
      }
    } on BleException {
      return _Outcome.retry;
    }
    if (!_alive(generation)) return _Outcome.retry;
    if (found == null) {
      _set(DeviceLinkStatus.notFound);
      return _Outcome.retry;
    }

    _set(DeviceLinkStatus.connecting);
    final BleLink link;
    try {
      link = await _transport.connect(found.id);
    } on BleException {
      _set(DeviceLinkStatus.disconnected);
      return _Outcome.retry;
    }
    _link = link;
    if (!_alive(generation)) {
      await _closeLink();
      return _Outcome.retry;
    }

    try {
      final mtu = await link.requestMtu(requestedMtu);
      if (mtu < minimumMtu) {
        await _closeLink();
        _set(DeviceLinkStatus.incompatiblePhone);
        return _Outcome.stopForUser;
      }
      final version = ByteData.sublistView(await link.read(BleUuids.deviceInfoService, BleUuids.protocolVersion)).getUint16(0, Endian.little);
      if (version >> 8 != bleProtocolVersion >> 8) {
        await _closeLink();
        _set(DeviceLinkStatus.unsupportedVersion);
        return _Outcome.stopForUser;
      }
      final serial = utf8.decode(await link.read(BleUuids.deviceInfoService, BleUuids.serialNumber), allowMalformed: true).replaceAll('\u0000', '');
      _set(DeviceLinkStatus.authenticating);
      if (serial != device.serialNumber || !await _authenticate(link, device)) {
        await _closeLink();
        if (!_alive(generation)) return _Outcome.retry;
        _set(DeviceLinkStatus.authFailed);
        return _Outcome.stopForUser;
      }
      if (!_alive(generation)) return _Outcome.retry;

      await link.write(BleUuids.telemetryService, BleUuids.timeSync, encodeTimeSync(DateTime.now().millisecondsSinceEpoch));
      _lastSeq = -1;
      _lastHash = null;
      _frameSubscription = (await link.subscribe(BleUuids.telemetryService, BleUuids.realtimeFrame)).listen(_onFrame, onError: (_) {});
      _set(DeviceLinkStatus.connected);
      return _Outcome.connected;
    } on BleException {
      await _closeLink();
      if (_alive(generation)) _set(DeviceLinkStatus.disconnected);
      return _Outcome.retry;
    }
  }

  /// 챌린지 서명 확인. 시험 단말(공개키 없음, 운전자 동의)은 응답만 확인한다.
  Future<bool> _authenticate(BleLink link, DriverDevice device) async {
    final nonce = Uint8List.fromList(List<int>.generate(attestationNonceSize, (_) => _random.nextInt(256)));
    final responses = await link.subscribe(BleUuids.securityService, BleUuids.authResponse);
    final first = responses.first.timeout(authTimeout);
    await link.write(BleUuids.securityService, BleUuids.authChallenge, nonce);
    final Uint8List signature;
    try {
      signature = await first;
    } on TimeoutException {
      return false;
    } on StateError {
      return false;
    }
    final key = device.authPublicKey;
    if (key == null) return signature.length == signatureSize;
    return verifyAttestation(serial: device.serialNumber, nonce: nonce, signature: signature, publicKey: key);
  }

  void _onFrame(Uint8List bytes) {
    if (bytes.length != packetSize) return;
    final record = decodePacketRecord(bytes, 0);
    // 같은 체인 안에서 이어지는지 확인(유실은 세고, 체인 불일치는 진단으로만 남긴다. 실시간 프레임은 증거가 아님)
    if (_lastSeq >= 0) {
      if (record.sequenceId > _lastSeq + 1) lostFrames += record.sequenceId - _lastSeq - 1;
      if (record.sequenceId == _lastSeq + 1 && _lastHash != null && !_sameBytes(record.prevHash, _lastHash!)) chainErrors += 1;
    }
    _lastSeq = record.sequenceId;
    _lastHash = sha256(bytes);
    _frames.add(RealtimeFrame(record));
  }

  static bool _sameBytes(List<int> a, List<int> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }

  /// 보정값을 단말에 쓴다. 연결·인증된 상태가 아니거나 단말이 거부하면 [CalibrationWriteException].
  Future<void> writeCalibration(CalibrationValues values) async {
    final link = _link;
    if (link == null || !isConnected) {
      throw const CalibrationWriteException('단말기에 보정값을 전달하지 못했습니다. 단말 연결 상태를 확인하고 다시 시도해주세요.');
    }
    try {
      await link.write(BleUuids.telemetryService, BleUuids.calibration, values.encode());
    } on BleException catch (error) {
      throw CalibrationWriteException(
        error.code == BleErrorCodes.invalidCalibration
            ? '단말이 보정값을 거부했습니다(가동 범위 5mm 미만). 처음부터 다시 측정해 주세요.'
            : '단말기에 보정값을 전달하지 못했습니다. 단말 연결 상태를 확인하고 다시 시도해주세요.',
      );
    }
  }

  Future<void> _closeLink() async {
    await _frameSubscription?.cancel();
    _frameSubscription = null;
    final link = _link;
    _link = null;
    if (link != null) {
      try {
        await link.disconnect();
      } on BleException {
        // 이미 끊김
      }
    }
  }

  @override
  void dispose() {
    _running = false;
    _generation += 1;
    _wakeUp();
    unawaited(_closeLink());
    unawaited(_frames.close());
    super.dispose();
  }
}

enum _Outcome { connected, retry, stopForUser }
