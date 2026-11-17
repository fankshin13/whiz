import 'package:material_ui/material_ui.dart';

import '../../../core/text/keep_all.dart';
import '../../../core/theme/app_theme.dart';
import '../application/device_link_controller.dart';

// 화면 문구(테스트에서도 쓴다)
const bluetoothOffMessage = '스마트폰 블루투스가 꺼져 있습니다. 블루투스를 켜주세요.';
const permissionNeededMessage = '근처 기기 검색 권한이 필요합니다. 설정에서 권한을 허용해주세요.';
const authFailedMessage = '단말 보안 인증에 실패했습니다. 등록되지 않았거나 위조된 기기입니다.';
const connectedMessage = '페달아이 단말과 안전하게 연결되었습니다.';
const testDeviceMessage = '단말 인증 키가 설정되지 않은 시험용 장치입니다. 개발 및 테스트 목적으로만 연결이 허용됩니다.';
const notFoundMessage = '단말 전원이 켜져 있는지 확인해주세요. (차량 시동 ACC 전원)';
const disconnectedMessage = '단말 연결이 끊겼습니다. 다시 연결하는 중입니다.';
const noDeviceMessage = '배정된 페달아이 단말이 없습니다. 관리자에게 문의하세요.';

enum _Tone { good, warning, danger, neutral }

/// 홈 화면 단말 연결 상태. 상태마다 다음 행동(블루투스 켜기·설정·다시 시도·시험 단말 동의)을 준다.
class DeviceStatusCard extends StatelessWidget {
  const DeviceStatusCard({super.key, required this.link});
  final DeviceLinkController link;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: link,
      builder: (context, _) {
        final serial = link.device?.serialNumber;
        final (tone, icon, title, message, actions) = switch (link.status) {
          DeviceLinkStatus.connected => (_Tone.good, Icons.verified_user, '연결됨', connectedMessage, <Widget>[]),
          DeviceLinkStatus.bluetoothOff => (
            _Tone.neutral,
            Icons.bluetooth_disabled,
            '블루투스 꺼짐',
            bluetoothOffMessage,
            [FilledButton(onPressed: link.requestEnableBluetooth, child: const Text('블루투스 활성화'))],
          ),
          DeviceLinkStatus.permissionDenied => (
            _Tone.warning,
            Icons.bluetooth_searching,
            '권한 필요',
            permissionNeededMessage,
            [FilledButton(onPressed: link.retry, child: const Text('권한 다시 요청'))],
          ),
          DeviceLinkStatus.permissionPermanentlyDenied => (
            _Tone.warning,
            Icons.bluetooth_searching,
            '권한 거부됨',
            permissionNeededMessage,
            [
              FilledButton(onPressed: link.openSettings, child: const Text('앱 설정으로 이동')),
              OutlinedButton(onPressed: link.retry, child: const Text('다시 확인')),
            ],
          ),
          DeviceLinkStatus.authFailed => (
            _Tone.danger,
            Icons.gpp_bad,
            '인증 실패',
            authFailedMessage,
            [OutlinedButton(onPressed: link.retry, child: const Text('배정 정보 다시 조회'))],
          ),
          DeviceLinkStatus.testDeviceConsentRequired => (
            _Tone.warning,
            Icons.science_outlined,
            '인증 미설정 단말',
            testDeviceMessage,
            [FilledButton(onPressed: () => _confirmTestDevice(context), child: const Text('시험 단말로 연결'))],
          ),
          DeviceLinkStatus.unassigned => (_Tone.neutral, Icons.link_off, '배정 단말 없음', noDeviceMessage, [OutlinedButton(onPressed: link.retry, child: const Text('다시 확인'))]),
          DeviceLinkStatus.deviceLoadFailed => (
            _Tone.neutral,
            Icons.cloud_off,
            '단말 정보 확인 실패',
            '네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
            [OutlinedButton(onPressed: link.retry, child: const Text('다시 시도'))],
          ),
          DeviceLinkStatus.notFound => (_Tone.neutral, Icons.search, '단말을 찾는 중', notFoundMessage, [OutlinedButton(onPressed: link.retry, child: const Text('단말 다시 찾기'))]),
          DeviceLinkStatus.disconnected => (_Tone.warning, Icons.sync_problem, '연결 끊김', disconnectedMessage, <Widget>[]),
          DeviceLinkStatus.incompatiblePhone => (
            _Tone.danger,
            Icons.phonelink_erase,
            '지원하지 않는 휴대폰',
            '이 휴대폰은 페달아이 단말의 데이터 크기(MTU)를 지원하지 않습니다. 다른 휴대폰을 사용해 주세요.',
            <Widget>[],
          ),
          DeviceLinkStatus.unsupportedVersion => (
            _Tone.danger,
            Icons.system_update,
            '업데이트 필요',
            '단말과 앱의 통신 규격 버전이 다릅니다. 앱 또는 단말을 업데이트해 주세요.',
            <Widget>[],
          ),
          DeviceLinkStatus.authenticating => (_Tone.neutral, Icons.shield_outlined, '보안 확인 중', '단말 보안 무결성 검증 중...', <Widget>[]),
          DeviceLinkStatus.idle ||
          DeviceLinkStatus.checkingPermission ||
          DeviceLinkStatus.loadingDevice ||
          DeviceLinkStatus.scanning ||
          DeviceLinkStatus.connecting => (
            _Tone.neutral,
            Icons.bluetooth_searching,
            '연결 중',
            serial == null ? '배정 단말을 확인하는 중입니다...' : '배정 단말(SN: $serial)을 찾는 중입니다...',
            <Widget>[],
          ),
        };
        final (fg, bg) = switch (tone) {
          _Tone.good => (AppColors.good, AppColors.goodBg),
          _Tone.warning => (AppColors.textMain, AppColors.dualWarning.withValues(alpha: 0.15)),
          _Tone.danger => (AppColors.critical, AppColors.criticalBg),
          _Tone.neutral => (AppColors.textMuted, AppColors.bgPanel),
        };
        final text = Theme.of(context).textTheme;
        return Semantics(
          container: true,
          liveRegion: true,
          label: '단말 상태: $title',
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.s3),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Wrap(
                    spacing: AppSpacing.s2,
                    runSpacing: AppSpacing.s1,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s2, vertical: 2),
                        decoration: BoxDecoration(
                          color: bg,
                          borderRadius: BorderRadius.circular(AppRadius.md),
                          border: Border.all(color: tone == _Tone.warning ? AppColors.dualWarning : fg),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(icon, size: 18, color: fg),
                            const SizedBox(width: AppSpacing.s1),
                            Text(title, style: text.labelLarge?.copyWith(color: fg)),
                          ],
                        ),
                      ),
                      if (serial != null) Text('단말 $serial', style: text.bodySmall?.copyWith(color: AppColors.textMuted)),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.s2),
                  Text(keepAll(message), style: text.bodyMedium),
                  if (actions.isNotEmpty) ...[
                    const SizedBox(height: AppSpacing.s3),
                    Wrap(spacing: AppSpacing.s2, runSpacing: AppSpacing.s2, children: actions),
                  ],
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Future<void> _confirmTestDevice(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('시험 단말에 연결할까요?'),
        content: Text(keepAll('$testDeviceMessage 단말이 진짜인지 확인할 수 없으므로 실제 운행에는 쓰지 마세요.')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('취소')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('연결')),
        ],
      ),
    );
    if (ok == true) link.acceptTestDevice();
  }
}
