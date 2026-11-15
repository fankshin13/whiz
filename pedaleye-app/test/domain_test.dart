import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:pedaleye_app/core/config/app_config.dart';
import 'package:pedaleye_app/core/router/app_router.dart';
import 'package:pedaleye_app/features/auth/application/session_controller.dart';
import 'package:pedaleye_app/features/auth/domain/invite_token.dart';
import 'package:pedaleye_app/features/auth/domain/user_role.dart';
import 'package:pedaleye_app/features/home/data/driver_home_repository.dart';

String jwt(Map<String, Object> payload) =>
    'eyJhbGciOiJIUzI1NiJ9.${base64Url.encode(utf8.encode(jsonEncode(payload))).replaceAll('=', '')}.sig';

void main() {
  final token = 'ab' * 32;

  group('InviteToken.parse', () {
    test('토큰만, 웹 초대 링크 전체, 앞뒤 공백·대문자를 모두 받는다', () {
      expect(InviteToken.parse(token), token);
      expect(InviteToken.parse('  https://pedaleye.vercel.app/auth/invite?token=$token \n'), token);
      expect(InviteToken.parse('pedaleye://invite?token=$token'), token);
      expect(InviteToken.parse(token.toUpperCase()), token);
    });

    test('형식이 틀리면 null', () {
      expect(InviteToken.parse(''), isNull);
      expect(InviteToken.parse('abc'), isNull);
      expect(InviteToken.parse('${token}0'), isNull);
      expect(InviteToken.parse('https://x/auth/invite?token=zz'), isNull);
      expect(InviteToken.parse('g' * 64), isNull);
    });
  });

  group('UserRole', () {
    test('DB 값 4종을 읽고 운전자만 앱을 쓸 수 있다', () {
      expect(UserRole.fromDb('driver')?.canUseApp, isTrue);
      for (final value in ['org_admin', 'super_admin', 'investigator']) {
        expect(UserRole.fromDb(value), isNotNull, reason: value);
        expect(UserRole.fromDb(value)!.canUseApp, isFalse, reason: value);
      }
      expect(UserRole.fromDb('admin'), isNull);
      expect(UserRole.fromDb(null), isNull);
    });
  });

  group('AppConfig', () {
    const url = 'https://abc.supabase.co';
    test('공개 키(publishable·anon JWT)만 받는다', () {
      expect(
        AppConfig.parse(url: url, anonKey: 'sb_publishable_x', webApi: 'https://c.example/').webApiBaseUrl.toString(),
        'https://c.example',
      );
      expect(
        AppConfig.parse(url: url, anonKey: jwt({'role': 'anon'}), webApi: 'https://c.example').supabaseAnonKey,
        isNotEmpty,
      );
    });

    test('서버 비밀 키·빈 값·잘못된 주소는 거부한다', () {
      expect(
        () => AppConfig.parse(url: url, anonKey: 'not-a-public-key', webApi: 'https://c'),
        throwsA(isA<AppConfigException>()),
      );
      expect(
        () => AppConfig.parse(url: url, anonKey: jwt({'role': 'authenticated'}), webApi: 'https://c'),
        throwsA(isA<AppConfigException>()),
      );
      expect(
        () => AppConfig.parse(url: '', anonKey: 'sb_publishable_x', webApi: 'https://c'),
        throwsA(isA<AppConfigException>()),
      );
      expect(
        () => AppConfig.parse(url: url, anonKey: 'sb_publishable_x', webApi: 'not a url'),
        throwsA(isA<AppConfigException>()),
      );
    });
  });

  group('라우터 가드', () {
    Uri u(String s) => Uri.parse(s);

    test('로그아웃 상태는 로그인·초대만 허용', () {
      expect(sessionRedirect(SessionStatus.signedOut, u('/home')), '/login');
      expect(sessionRedirect(SessionStatus.signedOut, u('/records')), '/login');
      expect(sessionRedirect(SessionStatus.signedOut, u('/login')), isNull);
      expect(sessionRedirect(SessionStatus.signedOut, u('/invite?token=$token')), isNull);
    });

    test('운전자가 아니면 어떤 경로든 안내 화면으로 격리', () {
      for (final path in ['/home', '/calibration', '/records', '/login', '/invite']) {
        expect(sessionRedirect(SessionStatus.notDriver, u(path)), '/not-driver', reason: path);
      }
      expect(sessionRedirect(SessionStatus.notDriver, u('/not-driver')), isNull);
    });

    test('운전자는 탭 화면만, 확인 중·역할 확인 실패는 각 안내 화면', () {
      expect(sessionRedirect(SessionStatus.driver, u('/login')), '/home');
      expect(sessionRedirect(SessionStatus.driver, u('/not-driver')), '/home');
      expect(sessionRedirect(SessionStatus.driver, u('/records')), isNull);
      expect(sessionRedirect(SessionStatus.checking, u('/home')), '/checking');
      expect(sessionRedirect(SessionStatus.roleCheckFailed, u('/home')), '/connect-error');
    });

    test('초대 딥링크(pedaleye://invite, 웹 초대 주소)는 /invite 로 바뀐다', () {
      expect(sessionRedirect(SessionStatus.signedOut, u('pedaleye://invite?token=$token')), '/invite?token=$token');
      expect(sessionRedirect(SessionStatus.signedOut, u('/auth/invite?token=$token')), '/invite?token=$token');
      // 이미 로그인한 운전자는 홈으로
      expect(sessionRedirect(SessionStatus.driver, u('pedaleye://invite?token=$token')), '/home');
    });
  });

  group('홈 데이터 파싱', () {
    test('프로필·조직·차량을 읽고 연식 표기를 만든다', () {
      final data = SupabaseDriverHomeRepository.parse(
        userId: 'u',
        profile: {
          'name': '김운전',
          'organizations': {'name': '화성시 교통안전과'},
        },
        vehicle: {'id': 'v', 'plate_number': '12가 3456', 'model_name': '아이오닉 5', 'model_year': 2024},
      );
      expect(data.orgName, '화성시 교통안전과');
      expect(data.assignedVehicle?.modelLabel, '아이오닉 5 (2024년형)');
    });

    test('차량이 없으면 null, 연식이 없으면 모델명만', () {
      final data = SupabaseDriverHomeRepository.parse(
        userId: 'u',
        profile: {'name': '김운전', 'organizations': null},
        vehicle: null,
      );
      expect(data.assignedVehicle, isNull);
      expect(data.orgName, '소속 없음');
      final noYear = SupabaseDriverHomeRepository.parse(
        userId: 'u',
        profile: {'name': 'a'},
        vehicle: {'id': 'v', 'plate_number': 'p', 'model_name': '포터2', 'model_year': null},
      );
      expect(noYear.assignedVehicle?.modelLabel, '포터2');
    });
  });
}
