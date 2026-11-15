// 로컬 Supabase 대상: 앱의 단말 조회·보정값 저장이 RLS 안에서만 동작하는지 확인한다.
// 실행: scripts/test-local-stack.sh (끝나면 보정값을 공장 기본값으로 되돌린다)
import 'package:flutter_test/flutter_test.dart';
import 'package:pedaleye_app/core/calibration/calibration_wizard_state_machine.dart';
import 'package:pedaleye_app/features/auth/data/auth_repository.dart';
import 'package:pedaleye_app/features/calibration/data/device_repository.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

const supabaseUrl = String.fromEnvironment('SUPABASE_URL');
const anonKey = String.fromEnvironment('SUPABASE_ANON_KEY');
const password = 'Pedaleye-Test-2026!';
const deviceA = '40000000-0000-0000-0000-000000000001';
const deviceB = '40000000-0000-0000-0000-000000000002';

/// 앱 캘리브레이션 화면이 모의 센서로 만드는 값과 같다(가속 120.50→80.50mm, 제동 130.00→95.00mm)
const appPayload = CalibrationPayload(
  deviceId: deviceA,
  accelCalibMin: 8050,
  accelCalibMax: 12050,
  brakeCalibMin: 9500,
  brakeCalibMax: 13000,
);

Future<(SupabaseClient, String)> signIn(String email) async {
  final client = SupabaseClient(supabaseUrl, anonKey, authOptions: const AuthClientOptions(autoRefreshToken: false));
  final auth = SupabaseAuthRepository(client);
  await auth.signIn(email: email, password: password);
  return (client, auth.currentUserId!);
}

void main() {
  if (supabaseUrl.isEmpty) {
    test('로컬 스택 설정 없음', () {}, skip: 'scripts/test-local-stack.sh 로 실행하세요');
    return;
  }

  test('운전자는 본인 차량 단말을 읽고 보정값 4개를 저장한다', () async {
    final (client, uid) = await signIn('driver.a@pedaleye.test');
    final repo = SupabaseDeviceRepository(client);
    final before = await repo.loadMyDevice(uid);
    expect(before?.deviceId, deviceA);
    expect(before?.plateNumber, '12가 3456');

    await repo.saveCalibration(appPayload);
    final after = (await repo.loadMyDevice(uid))!;
    expect(after.isCalibrated, isTrue);
    expect(
      (
        after.calibration.accelCalibMin,
        after.calibration.accelCalibMax,
        after.calibration.brakeCalibMin,
        after.calibration.brakeCalibMax,
      ),
      (8050, 12050, 9500, 13000),
    );
  });

  test('다른 운전자의 단말은 바꿀 수 없다(RLS: 0행 → forbidden)', () async {
    final (client, _) = await signIn('driver.a@pedaleye.test');
    final repo = SupabaseDeviceRepository(client);
    await expectLater(
      repo.saveCalibration(
        const CalibrationPayload(
          deviceId: deviceB,
          accelCalibMin: 8050,
          accelCalibMax: 12050,
          brakeCalibMin: 9500,
          brakeCalibMax: 13000,
        ),
      ),
      throwsA(isA<CalibrationSaveException>().having((e) => e.failure, 'failure', CalibrationSaveFailure.forbidden)),
    );
  });

  test('가동 범위 5mm 미만은 저장 전에 거부', () async {
    final (client, _) = await signIn('driver.a@pedaleye.test');
    await expectLater(
      SupabaseDeviceRepository(client).saveCalibration(
        const CalibrationPayload(
          deviceId: deviceA,
          accelCalibMin: 12000,
          accelCalibMax: 12050,
          brakeCalibMin: 9500,
          brakeCalibMax: 13000,
        ),
      ),
      throwsA(
        isA<CalibrationSaveException>().having((e) => e.failure, 'failure', CalibrationSaveFailure.invalidStroke),
      ),
    );
  });

  test('관리자(웹 콘솔 조회 경로)도 앱이 저장한 같은 값을 본다', () async {
    final (client, _) = await signIn('admin.hwaseong@pedaleye.test');
    final row = await client
        .from('devices')
        .select('accel_calib_min, accel_calib_max, brake_calib_min, brake_calib_max')
        .eq('id', deviceA)
        .single();
    expect(row, {'accel_calib_min': 8050, 'accel_calib_max': 12050, 'brake_calib_min': 9500, 'brake_calib_max': 13000});
  });

  test('배정 차량이 없는 계정은 단말 없음(null)', () async {
    final (client, uid) = await signIn('investigator.hwaseong@pedaleye.test');
    expect(await SupabaseDeviceRepository(client).loadMyDevice(uid), isNull);
  });
}
