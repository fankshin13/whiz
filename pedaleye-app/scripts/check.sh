#!/usr/bin/env bash
# 완료 기준 검사: 정적 분석 → 테스트 → Android 디버그 APK → 서버 비밀 키 포함 여부 검사
# 사용: scripts/check.sh            (APK 빌드 포함, Android SDK 필요)
#       SKIP_APK=1 scripts/check.sh (분석·테스트·소스 검사만)
set -euo pipefail
cd "$(dirname "$0")/.."

flutter analyze
flutter test

scan_targets=(lib test android/app/src assets pubspec.yaml)
if [[ "${SKIP_APK:-0}" != "1" ]]; then
  flutter build apk --debug
  scan_targets+=(build/app/outputs/flutter-apk/app-debug.apk)
fi

# 서버 권한 키 이름·형식(새 형식 비밀 키 접두사, JWT 역할값)이 앱 소스·APK 에 없어야 한다
pattern='service_role|SERVICE_ROLE|sb_secret_'
if grep -raIlE "$pattern" "${scan_targets[@]}" 2>/dev/null || { [[ -f build/app/outputs/flutter-apk/app-debug.apk ]] && unzip -p build/app/outputs/flutter-apk/app-debug.apk | grep -aqE "$pattern"; }; then
  echo "실패: 서버 비밀 키 흔적이 발견되었습니다." >&2
  exit 1
fi
echo "통과: 분석·테스트$([[ "${SKIP_APK:-0}" != "1" ]] && echo '·APK 빌드')·비밀 키 검사"
