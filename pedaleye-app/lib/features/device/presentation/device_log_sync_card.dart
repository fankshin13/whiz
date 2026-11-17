import 'package:material_ui/material_ui.dart';

import '../../../core/text/keep_all.dart';
import '../../../core/theme/app_theme.dart';
import '../application/device_log_sync.dart';

String _kb(int bytes) => '${(bytes / 1000).toStringAsFixed(1)} KB';

/// 단말 사고 기록 백업 진행(홈). 진행률·받은 크기·남은 크기, 실패 원인과 다시 시도.
class DeviceLogSyncCard extends StatelessWidget {
  const DeviceLogSyncCard({super.key, required this.sync});
  final DeviceLogSync sync;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: sync,
      builder: (context, _) {
        if (sync.phase == LogSyncPhase.idle) return const SizedBox.shrink();
        final text = Theme.of(context).textTheme;
        final downloading = sync.phase == LogSyncPhase.downloading && sync.totalBytes > 0;
        final percent = downloading ? (sync.receivedBytes * 100 / sync.totalBytes).floor() : null;
        final (icon, color, title) = switch (sync.phase) {
          LogSyncPhase.downloading => (Icons.download, AppColors.dualWarning, '단말 사고 기록 백업 중'),
          LogSyncPhase.verifying => (Icons.verified_outlined, AppColors.accel, '무결성 검증 중'),
          LogSyncPhase.uploading => (Icons.cloud_upload_outlined, AppColors.textMuted, '업로드 대기'),
          LogSyncPhase.done => (Icons.check_circle, AppColors.good, '백업 완료'),
          LogSyncPhase.failed => (Icons.error_outline, AppColors.critical, '백업 확인 필요'),
          _ => (Icons.sync, AppColors.textMuted, '확인 중'),
        };
        return Semantics(
          container: true,
          liveRegion: true,
          label: '사고 기록 백업: $title',
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.s3),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Icon(icon, color: color, size: 22),
                      const SizedBox(width: AppSpacing.s2),
                      Expanded(child: Text(title, style: text.titleSmall)),
                    ],
                  ),
                  if (percent != null) ...[
                    const SizedBox(height: AppSpacing.s3),
                    LinearProgressIndicator(value: sync.receivedBytes / sync.totalBytes, minHeight: 8, color: AppColors.accel),
                    const SizedBox(height: AppSpacing.s2),
                    Text(
                      '$percent% (${_kb(sync.receivedBytes)} / ${_kb(sync.totalBytes)}) · 남은 ${_kb(sync.totalBytes - sync.receivedBytes)}',
                      style: text.bodyMedium?.copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
                    ),
                    if (sync.pendingSessions > 1) Text('남은 기록 ${sync.pendingSessions}건', style: text.bodySmall),
                  ],
                  if (sync.message case final message?) ...[
                    const SizedBox(height: AppSpacing.s2),
                    Text(keepAll(message), style: text.bodyMedium),
                  ],
                  if (sync.phase == LogSyncPhase.failed && !sync.busy) ...[
                    const SizedBox(height: AppSpacing.s3),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: OutlinedButton.icon(onPressed: sync.syncNow, icon: const Icon(Icons.refresh), label: const Text('다시 시도')),
                    ),
                  ],
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
