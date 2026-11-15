import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:material_ui/material_ui.dart';
import 'package:pedaleye_app/app.dart';
import 'package:pedaleye_app/features/auth/application/session_controller.dart';
import 'package:pedaleye_app/features/auth/data/auth_repository.dart';
import 'package:pedaleye_app/features/auth/data/invite_repository.dart';
import 'package:pedaleye_app/features/auth/domain/user_role.dart';
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
}) async {
  final session = SessionController(auth);
  await session.start();
  await tester.pumpWidget(
    PedalEyeApp(
      session: session,
      auth: auth,
      invites: invites ?? fakeInvites((_, _) => (500, <String, Object?>{})),
      home: home ?? FakeHomeRepository(driverHome),
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
