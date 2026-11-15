import 'package:material_ui/material_ui.dart';

import '../../../app_scope.dart';
import '../../../core/text/keep_all.dart';
import '../../../core/theme/app_theme.dart';
import '../application/event_sync_controller.dart';
import '../data/event_simulator.dart';
import '../domain/event_models.dart';

const backupInProgressMessage = '사고 전후 60초 페달 기록을 기기에 안전하게 동결 중입니다...';
const backupOfflineMessage = '오프라인 상태입니다. 기기에 안전하게 보관되었으며 네트워크 연결 시 자동 업로드됩니다.';
const backupUploadedMessage = '사고 기록을 기기에 보관하고 서버 무결성 검증까지 마쳤습니다.';
const backupUploadFailedMessage = '기기에 안전하게 보관했지만 서버 업로드에 실패했습니다. 내 사고 기록에서 다시 올릴 수 있습니다.';

enum BackupKind { manual, suddenBrakeSimulation }

/// 긴급 백업·급제동 시뮬레이션 공통 실행. 기기 저장이 먼저이고 업로드는 가능할 때만 한다.
Future<void> runEventBackup(BuildContext context, BackupKind kind) async {
  final scope = AppScope.of(context);
  final messenger = ScaffoldMessenger.of(context);
  final userId = scope.session.userId;
  if (userId == null) return;
  messenger.showSnackBar(
    const SnackBar(
      duration: Duration(minutes: 1),
      content: Row(
        children: [
          SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.bgBase)),
          SizedBox(width: AppSpacing.s3),
          Expanded(child: Text(backupInProgressMessage)),
        ],
      ),
    ),
  );
  String message;
  try {
    final device = await scope.devices.loadMyDevice(userId);
    if (device == null) {
      message = '배정된 페달아이 단말기가 없어 기록을 만들 수 없습니다.';
    } else {
      final session = kind == BackupKind.manual
          ? EventSimulator.manualBackup(device.deviceId)
          : EventSimulator.suddenBrake(device.deviceId);
      message = switch (await scope.eventSync.backup(device.deviceId, session)) {
        BackupOutcome.uploaded => backupUploadedMessage,
        BackupOutcome.savedOffline => backupOfflineMessage,
        BackupOutcome.savedUploadFailed => backupUploadFailedMessage,
      };
    }
  } on Exception {
    message = '단말기 정보를 확인하지 못해 기록을 만들지 못했습니다. 다시 시도해 주세요.';
  }
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}

/// 무결성·업로드 상태 배지. 아이콘과 글자로 상태를 알린다(색만으로 구분하지 않음).
class IntegrityBadge extends StatelessWidget {
  const IntegrityBadge._(this.label, this.icon, this.fg, this.bg);

  factory IntegrityBadge.server({required bool verified}) => verified
      ? const IntegrityBadge._('무결성 검증 통과', Icons.check_circle, AppColors.good, AppColors.goodBg)
      : const IntegrityBadge._(
          '해시 체인 불일치 (변조 감지)',
          Icons.warning_amber_rounded,
          AppColors.critical,
          AppColors.criticalBg,
        );

  factory IntegrityBadge.local(LocalEventBackup backup) => switch (backup.status) {
    UploadStatus.uploading => const IntegrityBadge._(
      '무결성 검증 요청 중',
      Icons.cloud_upload_outlined,
      AppColors.textMain,
      AppColors.bgPanel,
    ),
    UploadStatus.failed => const IntegrityBadge._(
      '업로드 실패',
      Icons.error_outline,
      AppColors.critical,
      AppColors.criticalBg,
    ),
    UploadStatus.completed => IntegrityBadge.server(verified: backup.integrityVerified ?? false),
    UploadStatus.pending => const IntegrityBadge._('서버 업로드 대기', Icons.schedule, AppColors.textMain, AppColors.bgPanel),
  };

  final String label;
  final IconData icon;
  final Color fg;
  final Color bg;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s2, vertical: 2),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: fg.withValues(alpha: 0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: fg),
          const SizedBox(width: AppSpacing.s1),
          Flexible(
            child: Text(
              keepAll(label),
              style: TextStyle(color: fg, fontSize: 13, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}
