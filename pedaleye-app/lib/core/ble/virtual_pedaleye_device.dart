/// 규격(docs/ble-protocol.md)대로 동작하는 가상 페달아이 단말과 가상 블루투스.
///
/// 실물 기판이 없어 테스트와 개발용 '가상 단말' 모드에서 쓴다. 시험 키는 시험 벡터와 같은 공개 시험용이다
/// (서버 시드의 PE-2026-000001 공개키와 짝). 실제 단말·운영에서 쓰면 안 된다.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';

import '../forensics/hash_chain.dart' show buildChainedSession, sha256;
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

  /// 단말에 보관된 사고 기록(보관 순서 = 세션 번호)
  final List<StoredDeviceSession> sessions = [];

  /// 장애 주입(한 번씩): 이 번호의 청크를 보내지 않음 / 페이로드를 망가뜨림(CRC8 불일치) / 이 비율만큼 보낸 뒤 끊김
  int? dropChunkOnce;
  int? corruptChunkOnce;
  double? disconnectAtFraction;

  /// 전송 완료 상태의 CRC-32 를 한 번 틀리게 보고(전체 재수신 유도)
  bool wrongCrc32Once = false;

  /// 받은 명령 기록(시험에서 '삭제 확인을 언제 보냈는지' 확인)
  final List<String> commandLog = [];

  _VirtualLink? _link;
  bool get isConnected => _link != null && !_link!._closed;

  /// 60초(50Hz, 3,000레코드) 급제동 사고 기록을 만들어 보관한다. [tamper] 면 봉인 뒤 레코드 1420 을 1비트 바꾼다(단말 저장 손상·변조).
  Future<StoredDeviceSession> recordSession({String trigger = 'shock', int? startMs, int records = 3000, bool tamper = false}) async {
    final start = startMs ?? _clock() - 60000;
    final payloads = [
      for (var i = 0; i < records; i++)
        () {
          final t = i / records;
          final accel = t >= 0.42 && t < 0.58 ? 1.0 : 0.0; // 25~35초 급가속
          final brake = t >= 0.58 && t < 0.92 ? 1.0 : 0.0; // 35~55초 급제동
          int distance(int idle, int full, double press) => (idle + (full - idle) * press).round();
          return PacketPayload(
            sequenceId: i,
            timestampMs: start + i * 20,
            accelDistance: distance(MockPedalGeometry.accelIdle, MockPedalGeometry.accelFull, accel),
            accelPercent: (accel * 100).round(),
            brakeDistance: distance(MockPedalGeometry.brakeIdle, MockPedalGeometry.brakeFull, brake),
            brakePercent: (brake * 100).round(),
            bothPedal: false,
            latitudeE7: 375665000,
            longitudeE7: 1269780000,
            speedDeciKmh: brake > 0 ? 0 : (accel > 0 ? 700 : 500),
          );
        }(),
    ];
    final pel = buildChainedSession(serial, payloads);
    final finalHash = Uint8List.fromList(pel.sublist(pel.length - 32));
    final index = sessions.isEmpty ? 1 : sessions.last.index + 1;
    final draft = SessionIndexEntry(
      sessionId: index,
      trigger: trigger,
      archivedConfirmed: false,
      startMs: start,
      recordCount: records,
      byteLength: pel.length,
      finalHash: finalHash,
      sealSignature: Uint8List(64),
    );
    final seal = await _sign(draft.sealMessage(serial));
    if (tamper) pel[packetSize * 1420 + 17] ^= 0x01;
    final stored = StoredDeviceSession(index: index, trigger: trigger, startMs: start, recordCount: records, pel: pel, finalHash: finalHash, seal: seal);
    sessions.add(stored);
    return stored;
  }

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

class StoredDeviceSession {
  StoredDeviceSession({
    required this.index,
    required this.trigger,
    required this.startMs,
    required this.recordCount,
    required this.pel,
    required this.finalHash,
    required this.seal,
  });

  final int index;
  final String trigger;
  final int startMs;
  final int recordCount;
  final Uint8List pel;
  final Uint8List finalHash;
  final Uint8List seal;

  /// CONFIRM_ARCHIVED 를 받음(서버 검증 완료)
  bool archived = false;

  Uint8List entryBytes() {
    final b = ByteData(SessionIndexEntry.size)
      ..setUint32(0, index, Endian.little)
      ..setUint8(4, sessionTriggers.indexOf(trigger))
      ..setUint8(5, archived ? 1 : 0)
      ..setUint64(8, startMs, Endian.little)
      ..setUint32(16, recordCount, Endian.little)
      ..setUint32(20, pel.length, Endian.little);
    final out = b.buffer.asUint8List();
    out.setRange(24, 56, finalHash);
    out.setRange(56, 120, seal);
    return out;
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

  // 사고 기록 전송(규격 5.2~5.5)
  final _chunkOut = StreamController<Uint8List>.broadcast();
  static const _window = 8;
  TransferState _state = TransferState.idle;
  int _errorCode = 0;
  StoredDeviceSession? _session;
  List<DataChunk> _pending = const [];
  int _offset = 0;
  int _nextSeq = 0;
  int _lastAck = -1;
  int _sentBytes = 0;
  bool _pumping = false;

  void _close() {
    if (_closed) return;
    _closed = true;
    _frameTimer?.cancel();
    unawaited(_frames?.close());
    unawaited(_authResponses.close());
    unawaited(_chunkOut.close());
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
    if (characteristic == BleUuids.transferStatus) {
      _requireAuth();
      final session = _session;
      var crc = session == null || _state != TransferState.complete ? 0 : crc32(session.pel);
      if (crc != 0 && device.wrongCrc32Once) {
        device.wrongCrc32Once = false;
        crc ^= 0xffffffff;
      }
      final b = ByteData(18)
        ..setUint8(0, _state.index)
        ..setUint8(1, _errorCode)
        ..setUint32(2, session?.index ?? 0, Endian.little)
        ..setUint32(6, session?.pel.length ?? 0, Endian.little)
        ..setUint32(10, _offset + _sentBytes, Endian.little)
        ..setUint32(14, crc, Endian.little);
      return b.buffer.asUint8List();
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
    if (characteristic == BleUuids.sessionControl) {
      _requireAuth();
      _onControl(data);
      return;
    }
    if (characteristic == BleUuids.transferStatus) {
      _requireAuth();
      if (data.length != 3) throw const BleException('ACK 형식 오류');
      final seq = ByteData.sublistView(data).getUint16(1, Endian.little);
      if (data[0] == 0x10) {
        if (seq > _lastAck) _lastAck = seq;
      } else if (data[0] == 0x11) {
        _nextSeq = seq; // go-back-N
        _lastAck = seq - 1;
        if (_session != null && _state == TransferState.complete) _state = TransferState.sending;
      }
      _pump();
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
    if (characteristic == BleUuids.sessionDataChunk) {
      _requireAuth();
      return _chunkOut.stream;
    }
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

  void _onControl(Uint8List data) {
    if (data.length != 12) throw const BleException('제어 명령 형식 오류');
    final v = ByteData.sublistView(data);
    final command = data[0];
    final sessionId = v.getUint32(1, Endian.little);
    final offset = v.getUint32(5, Endian.little);
    device.commandLog.add('${switch (command) { 1 => 'START', 2 => 'PAUSE', 3 => 'CANCEL', 4 => 'LIST', 5 => 'CONFIRM', _ => '?' }} $sessionId${command == 1 ? '@$offset' : ''}');
    final session = device.sessions.where((s) => s.index == sessionId).firstOrNull;
    switch (command) {
      case 0x04: // LIST: 항목 하나씩 청크로
        _state = TransferState.listing;
        _session = null;
        var seq = 0;
        for (final s in device.sessions) {
          _chunkOut.add(DataChunk(seq: seq++, payload: s.entryBytes()).encode());
        }
        _state = TransferState.complete;
      case 0x01:
        if (session == null) {
          _fail(BleErrorCodes.invalidSession);
          throw const BleException('없는 세션', code: BleErrorCodes.invalidSession);
        }
        if (offset >= session.pel.length) {
          _fail(BleErrorCodes.invalidOffset);
          throw const BleException('오프셋 오류', code: BleErrorCodes.invalidOffset);
        }
        _session = session;
        _offset = offset;
        _pending = splitIntoChunks(session.pel, offset);
        _nextSeq = 0;
        _lastAck = -1;
        _sentBytes = 0;
        _errorCode = 0;
        _state = TransferState.sending;
        _pump();
      case 0x02:
        if (_state == TransferState.sending) _state = TransferState.paused;
      case 0x03:
        _state = TransferState.idle;
        _session = null;
      case 0x05:
        if (session == null) throw const BleException('없는 세션', code: BleErrorCodes.invalidSession);
        session.archived = true;
      default:
        throw const BleException('알 수 없는 명령');
    }
  }

  void _fail(int code) {
    _state = TransferState.error;
    _errorCode = code;
  }

  /// 창(8청크) 안에서 보낼 수 있는 만큼 보낸다. 짧게 쉬어 가며 보내 실제 무선처럼 끼어들 틈을 준다.
  void _pump() {
    if (_pumping || _closed) return;
    _pumping = true;
    Timer(const Duration(milliseconds: 1), () {
      _pumping = false;
      if (_closed || _state != TransferState.sending) return;
      var sent = 0;
      while (_nextSeq < _pending.length && _nextSeq <= _lastAck + _window && sent < _window) {
        final chunk = _pending[_nextSeq];
        _nextSeq += 1;
        sent += 1;
        _sentBytes = 0;
        for (var i = 0; i < _nextSeq; i++) {
          _sentBytes += _pending[i].payload.length;
        }
        if (device.dropChunkOnce == chunk.seq) {
          device.dropChunkOnce = null;
          continue; // 무선 유실
        }
        var bytes = chunk.encode();
        if (device.corruptChunkOnce == chunk.seq) {
          device.corruptChunkOnce = null;
          bytes = Uint8List.fromList(bytes)..[bytes.length - 1] ^= 0xff; // CRC8 불일치
        }
        _chunkOut.add(bytes);
        final fraction = device.disconnectAtFraction;
        final total = _session?.pel.length ?? 1;
        if (fraction != null && (_offset + _sentBytes) / total >= fraction) {
          device.disconnectAtFraction = null;
          _close();
          return;
        }
      }
      if (_nextSeq >= _pending.length) {
        _state = TransferState.complete;
        return;
      }
      if (_nextSeq <= _lastAck + _window) _pump();
    });
  }

  @override
  Future<void> disconnect() async => _close();
}
