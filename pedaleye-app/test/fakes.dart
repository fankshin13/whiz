import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:material_ui/material_ui.dart';
import 'package:pedaleye_app/app.dart';
import 'package:pedaleye_app/core/calibration/calibration_wizard_state_machine.dart';
import 'package:pedaleye_app/core/feedback/warning_feedback.dart';
import 'package:pedaleye_app/core/sensor/mock_pedal_sensor_source.dart';
import 'package:pedaleye_app/core/telemetry/telemetry_controller.dart';
import 'package:pedaleye_app/features/auth/application/session_controller.dart';
import 'package:pedaleye_app/features/auth/data/auth_repository.dart';
import 'package:pedaleye_app/features/auth/data/invite_repository.dart';
import 'package:pedaleye_app/features/auth/domain/user_role.dart';
import 'package:pedaleye_app/core/forensics/event_recorder.dart';
import 'package:pedaleye_app/core/forensics/hash_chain.dart';
import 'package:pedaleye_app/core/forensics/packet_codec.dart';
import 'package:pedaleye_app/features/calibration/data/device_repository.dart';
import 'package:pedaleye_app/features/events/application/event_sync_controller.dart';
import 'package:pedaleye_app/features/events/data/driver_events_repository.dart';
import 'package:pedaleye_app/features/events/data/event_simulator.dart';
import 'package:pedaleye_app/features/events/data/event_uploader.dart';
import 'package:pedaleye_app/features/events/data/local_event_store.dart';
import 'package:pedaleye_app/features/events/domain/event_models.dart';
import 'package:pedaleye_app/features/calibration/domain/driver_device.dart';
import 'package:pedaleye_app/features/home/data/driver_home_repository.dart';
import 'package:pedaleye_app/features/home/domain/driver_home_data.dart';

/// 메모리 안에서만 동작하는 인증 저장소. accounts: 이메일 → (비밀번호, 사용자 ID, 역할)
class FakeAuthRepository implements AuthRepository {
  FakeAuthRepository({Map<String, (String, String, UserRole)>? accounts, this.currentUserId})
    : accounts = accounts ?? {};

  final Map<String, (String, String, UserRole)> accounts;
  final _changes = StreamController<String?>.broadcast();
  SignInFailure? nextSignInFailure;
  bool roleLookupFails = false;
  bool deactivated = false;
  int roleLookups = 0;
  int signOuts = 0;

  @override
  String? currentUserId;

  @override
  Stream<String?> userIdChanges() => _changes.stream;

  @override
  Future<void> signIn({required String email, required String password}) async {
    final failure = nextSignInFailure;
    if (failure != null) throw SignInException(failure);
    final account = accounts[email.trim()];
    if (account == null || account.$1 != password) throw const SignInException(SignInFailure.invalidCredentials);
    currentUserId = account.$2;
    _changes.add(currentUserId);
  }

  @override
  Future<void> signOut() async {
    signOuts += 1;
    currentUserId = null;
    _changes.add(null);
  }

  @override
  Future<UserRole> fetchRole(String userId) async {
    roleLookups += 1;
    if (roleLookupFails) throw const RoleLookupException();
    if (deactivated) throw const AccountDeactivatedException();
    return accounts.values.firstWhere((a) => a.$2 == userId).$3;
  }
}

class FakeHomeRepository implements DriverHomeRepository {
  FakeHomeRepository(this.data);
  DriverHomeData? data;
  bool fail = false;
  int loads = 0;

  @override
  Future<DriverHomeData> load(String userId) async {
    loads += 1;
    if (fail || data == null) throw const HomeLoadException();
    return data!;
  }
}

const driverId = 'user-driver';
const adminId = 'user-admin';
const vehicle = VehicleSummary(vehicleId: 'v1', plateNumber: '12가 3456', modelName: '아이오닉 5', modelYear: 2024);
const driverHome = DriverHomeData(userId: driverId, driverName: '김운전', orgName: '화성시 교통안전과', assignedVehicle: vehicle);

FakeAuthRepository fakeAuth({String? signedInAs}) => FakeAuthRepository(
  accounts: {
    'driver.a@pedaleye.test': ('Pedaleye-Test-2026!', driverId, UserRole.driver),
    'admin.hwaseong@pedaleye.test': ('Pedaleye-Test-2026!', adminId, UserRole.orgAdmin),
  },
  currentUserId: signedInAs,
);

/// 웹 초대 API 흉내. handler 가 (경로, 본문) → (상태 코드, 응답 JSON) 을 정한다.
InviteRepository fakeInvites(
  FutureOr<(int, Map<String, Object?>)> Function(String path, Map<String, dynamic> body) handler,
) {
  return InviteRepository(
    baseUrl: Uri.parse('https://console.example'),
    client: MockClient((request) async {
      final (status, body) = await handler(request.url.path, jsonDecode(request.body) as Map<String, dynamic>);
      // 실제 서버(NextResponse.json)처럼 charset 없이 보낸다
      return http.Response.bytes(utf8.encode(jsonEncode(body)), status, headers: {'content-type': 'application/json'});
    }),
  );
}

/// 전체 앱(라우터 포함)을 가짜 저장소로 띄운다
Future<SessionController> pumpApp(
  WidgetTester tester, {
  required FakeAuthRepository auth,
  FakeHomeRepository? home,
  InviteRepository? invites,
  FakeDeviceRepository? devices,
  FakeSensors? sensors,
  FakeWarningFeedback? feedback,
  FakeEventsRepository? events,
  EventSyncController? eventSync,
}) async {
  final session = SessionController(auth);
  await session.start();
  await tester.pumpWidget(
    PedalEyeApp(
      session: session,
      auth: auth,
      invites: invites ?? fakeInvites((_, _) => (500, <String, Object?>{})),
      home: home ?? FakeHomeRepository(driverHome),
      devices: devices ?? FakeDeviceRepository(calibratedDevice),
      sensorFactory: (sensors ?? FakeSensors()).create,
      warningFeedback: feedback ?? FakeWarningFeedback(),
      events: events ?? FakeEventsRepository(),
      eventSync: eventSync ?? newEventSync(),
      webConsoleUrl: Uri.parse('https://pedaleye.vercel.app'),
    ),
  );
  await tester.pumpAndSettle();
  return session;
}

/// 운전석 거치 휴대폰 최소 폭(320dp)
void useNarrowPhone(WidgetTester tester) {
  tester.view.physicalSize = const Size(320 * 3, 640 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}

/// 모의 센서를 잡음 없이 만들고, 테스트가 조작할 수 있게 마지막 것을 기억한다
class FakeSensors {
  final created = <MockPedalSensorSource>[];
  MockPedalSensorSource get last => created.last;

  MockPedalSensorSource create() {
    final source = MockPedalSensorSource(noise: 0, clock: () => 0);
    created.add(source);
    return source;
  }
}

class FakeWarningFeedback implements WarningFeedback {
  int pulses = 0;

  @override
  Future<void> dualPressPulse() async => pulses += 1;
}

class FakeDeviceRepository implements DeviceRepository {
  FakeDeviceRepository(this.device);
  DriverDevice? device;
  bool loadFails = false;
  CalibrationSaveFailure? nextSaveFailure;
  final saved = <CalibrationPayload>[];

  @override
  Future<DriverDevice?> loadMyDevice(String userId) async {
    if (loadFails) throw const DeviceLoadException();
    return device;
  }

  @override
  Future<void> saveCalibration(CalibrationPayload payload) async {
    final failure = nextSaveFailure;
    if (failure != null) {
      nextSaveFailure = null;
      throw CalibrationSaveException(failure);
    }
    saved.add(payload);
    final d = device!;
    device = DriverDevice(
      deviceId: d.deviceId,
      serialNumber: d.serialNumber,
      plateNumber: d.plateNumber,
      calibration: PedalCalibration(
        accelCalibMin: payload.accelCalibMin,
        accelCalibMax: payload.accelCalibMax,
        brakeCalibMin: payload.brakeCalibMin,
        brakeCalibMax: payload.brakeCalibMax,
      ),
    );
  }
}

/// 웹 시뮬레이터와 같은 형상으로 보정된 단말
const calibratedDevice = DriverDevice(
  deviceId: '40000000-0000-0000-0000-000000000001',
  serialNumber: 'PE-2026-000001',
  plateNumber: '12가 3456',
  calibration: PedalCalibration(
    accelCalibMin: MockPedalGeometry.accelFull,
    accelCalibMax: MockPedalGeometry.accelIdle,
    brakeCalibMin: MockPedalGeometry.brakeFull,
    brakeCalibMax: MockPedalGeometry.brakeIdle,
  ),
);

const factoryDevice = DriverDevice(
  deviceId: '40000000-0000-0000-0000-000000000001',
  serialNumber: 'PE-2026-000001',
  plateNumber: '12가 3456',
  calibration: PedalCalibration(accelCalibMin: 0, accelCalibMax: 4095, brakeCalibMin: 0, brakeCalibMax: 4095),
);

// ── 사고 기록 ────────────────────────────────────────────────────────────

/// 메모리 안 백업 저장소(위젯 테스트는 가짜 시계라 실제 파일 입출력을 쓰지 않는다)
class MemoryBackupStore implements EventBackupStore {
  final meta = <String, LocalEventBackup>{};
  final bytes = <String, Uint8List>{};
  var _seq = 0;

  @override
  Future<LocalEventBackup> save(String userId, String deviceId, FrozenSession session) async {
    final id = 'b${_seq++}';
    bytes[id] = session.bytes;
    final backup = LocalEventBackup(
      localId: id,
      deviceId: deviceId,
      triggerType: session.triggerType,
      startTimeMs: session.startTimeMs,
      endTimeMs: session.endTimeMs,
      recordCount: session.recordCount,
      status: UploadStatus.pending,
      createdAtMs: 0,
    );
    meta[id] = backup;
    return backup;
  }

  @override
  Future<void> update(String userId, LocalEventBackup backup) async => meta[backup.localId] = backup;

  @override
  Future<List<LocalEventBackup>> list(String userId) async =>
      meta.values.toList()..sort((a, b) => b.startTimeMs.compareTo(a.startTimeMs));

  @override
  Future<Uint8List> readBytes(String userId, String localId) async => bytes[localId]!;
}

class FakeConnectivity implements Connectivity {
  FakeConnectivity({this.online = true});
  bool online;
  final _changes = StreamController<bool>.broadcast();

  void set(bool value) {
    online = value;
    _changes.add(value);
  }

  @override
  Future<bool> isOnline() async => online;

  @override
  Stream<bool> get onlineChanges => _changes.stream;
}

/// 서버 역할: 받은 원본을 서버와 같은 엔진으로 검증하고 FakeEventsRepository 에 세션을 만든다
class FakeUploader implements EventUploader {
  FakeUploader(this.server, this.connectivity);
  final FakeEventsRepository server;
  final FakeConnectivity connectivity;
  UploadException? nextFailure;
  final received = <Uint8List>[];

  @override
  Future<UploadOutcome> upload(LocalEventBackup backup, Uint8List pel) async {
    if (!connectivity.online) throw const UploadException(UploadFailure.network);
    final failure = nextFailure;
    if (failure != null) {
      nextFailure = null;
      throw failure;
    }
    received.add(pel);
    return server.addFromPel(backup, pel);
  }
}

class FakeEventsRepository implements DriverEventsRepository {
  final sessions = <ServerEventSession>[];
  final logs = <String, Uint8List>{};
  bool listFails = false;
  int lists = 0;

  UploadOutcome addFromPel(LocalEventBackup backup, Uint8List pel) {
    final result = verifyForTest(pel, backup.deviceId);
    final existing = sessions.where((s) => s.finalHash == result.finalHash && s.integrityVerified).firstOrNull;
    if (existing != null && result.isValid) {
      return UploadOutcome(sessionId: existing.id, integrityVerified: true, duplicate: true);
    }
    final id = '60000000-0000-0000-0000-${sessions.length.toString().padLeft(12, '0')}';
    sessions.insert(
      0,
      ServerEventSession(
        id: id,
        deviceId: backup.deviceId,
        triggerType: backup.triggerType,
        startTime: DateTime.fromMillisecondsSinceEpoch(backup.startTimeMs, isUtc: true),
        endTime: DateTime.fromMillisecondsSinceEpoch(backup.endTimeMs, isUtc: true),
        recordCount: packetCountOf(pel),
        integrityVerified: result.isValid,
        plateNumber: '12가 3456',
        initialHash: result.initialHash,
        finalHash: result.finalHash,
        rawLogPath: 'raw_logs/$id.pel',
      ),
    );
    logs[id] = pel;
    return UploadOutcome(sessionId: id, integrityVerified: result.isValid, duplicate: false);
  }

  @override
  Future<List<ServerEventSession>> listMySessions() async {
    lists++;
    if (listFails) throw const EventsLoadException();
    return List.of(sessions);
  }

  @override
  Future<ServerEventSession?> getSession(String id) async => sessions.where((s) => s.id == id).firstOrNull;

  @override
  Future<Uint8List> downloadLog(ServerEventSession session) async => logs[session.id]!;
}

/// 서버 업로드 검증과 같은 계산(제네시스 포함)
HashChainVerificationResult verifyForTest(Uint8List pel, String deviceId) => verifyBinaryHashChain(
  pel,
  expectedInitialHash: toHex(computeGenesisHash(deviceId, decodePacketRecord(pel, 0).timestampMs)),
);

EventSyncController newEventSync({
  FakeEventsRepository? server,
  FakeConnectivity? connectivity,
  MemoryBackupStore? store,
  EventUploader? uploader,
}) {
  final net = connectivity ?? FakeConnectivity();
  return EventSyncController(
    store: store ?? MemoryBackupStore(),
    uploader: uploader ?? FakeUploader(server ?? FakeEventsRepository(), net),
    connectivity: net,
  );
}

/// 패킷 #500 을 1비트 바꾼 급제동 세션
FrozenSession tamperedSession() {
  final s = EventSimulator.suddenBrake(calibratedDevice.deviceId, now: DateTime.utc(2026, 11, 15, 7));
  final bytes = Uint8List.fromList(s.bytes)..[500 * 64 + 14] ^= 0x01;
  return FrozenSession(
    triggerType: s.triggerType,
    triggerAtMs: s.triggerAtMs,
    startTimeMs: s.startTimeMs,
    endTimeMs: s.endTimeMs,
    recordCount: s.recordCount,
    bytes: bytes,
  );
}
