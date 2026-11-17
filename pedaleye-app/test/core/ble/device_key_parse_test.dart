import 'package:flutter_test/flutter_test.dart';
import 'package:pedaleye_app/features/calibration/data/device_repository.dart';

// 서버 devices.auth_public_key(Base64 44자) → 앱 32바이트 공개키
void main() {
  Map<String, dynamic> row(Object? key) => {
    'id': '40000000-0000-0000-0000-000000000001',
    'serial_number': 'PE-2026-000001',
    'auth_public_key': key,
    'accel_calib_min': 0,
    'accel_calib_max': 4095,
    'brake_calib_min': 0,
    'brake_calib_max': 4095,
    'vehicle': {'plate_number': '12가 3456', 'assigned_user_id': 'u'},
  };

  test('등록된 공개키는 32바이트로, 미등록은 null(시험 단말)로 읽는다', () {
    final device = SupabaseDeviceRepository.parse(row('BG5x7ngSCHA+azCCZJit+ZdvxKss/CdypW/cv0ASVlY='));
    expect(device.authPublicKey, hasLength(32));
    expect(device.authPublicKey!.first, 0x04);
    expect(device.hasAuthKey, isTrue);
    expect(SupabaseDeviceRepository.parse(row(null)).hasAuthKey, isFalse);
  });

  test('형식이 틀린 키는 단말 정보 오류로 처리한다(가짜 키로 연결하지 않음)', () {
    expect(() => SupabaseDeviceRepository.parse(row('@@@')), throwsA(isA<DeviceLoadException>()));
    expect(() => SupabaseDeviceRepository.parse(row('AAAA')), throwsA(isA<DeviceLoadException>()));
    expect(() => SupabaseDeviceRepository.parse(row(123)), throwsA(isA<DeviceLoadException>()));
  });
}
