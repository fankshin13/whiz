import 'dart:async';
import 'dart:convert';

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
import 'package:pedaleye_app/features/calibration/data/device_repository.dart';
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
      return http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json; charset=utf-8'});
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
