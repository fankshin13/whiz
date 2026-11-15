import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app_scope.dart';
import '../../../core/text/keep_all.dart';
import '../../../core/text/kst_format.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/status_message.dart';
import '../data/driver_events_repository.dart';
import '../domain/event_models.dart';
import 'event_widgets.dart';

const noEventsTitle = '기록된 사고 데이터가 없습니다.';
const noEventsMessage = '급제동 충격이 감지되거나 긴급 백업 버튼을 누르면 사고 전후 60초 데이터가 이곳에 보존됩니다.';
const eventsLoadFailedMessage = '사고 기록을 불러오지 못했습니다. 네트워크 연결을 확인해 주세요.';

/// 내 사고 기록: 기기에만 있는(업로드 전) 백업 + 서버에 저장된 본인 차량 세션
class DriverEventListScreen extends StatefulWidget {
  const DriverEventListScreen({super.key});

  @override
  State<DriverEventListScreen> createState() => _DriverEventListScreenState();
}

class _DriverEventListScreenState extends State<DriverEventListScreen> {
  Future<List<ServerEventSession>>? _server;
  int _seenCompleted = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _server ??= AppScope.of(context).events.listMySessions();
  }

  Future<void> _reload() async {
    final scope = AppScope.of(context);
    final next = scope.events.listMySessions();
    setState(() {
      _server = next;
    });
    await scope.eventSync.syncPending();
    try {
      await next;
    } on EventsLoadException {
      // 숨기지 않는다: FutureBuilder 가 같은 Future 의 오류 안내를 그린다
    }
  }

  @override
  Widget build(BuildContext context) {
    final sync = AppScope.of(context).eventSync;
    return Scaffold(
      appBar: AppBar(title: const Text('내 사고 기록')),
      body: ListenableBuilder(
        listenable: sync,
        builder: (context, _) {
          final local = sync.backups.where((b) => b.status != UploadStatus.completed).toList();
          // 업로드가 끝난 백업이 생기면 서버 목록을 새로 받는다
          final completed = sync.backups.length - local.length;
          if (completed != _seenCompleted) {
            _seenCompleted = completed;
            _server = AppScope.of(context).events.listMySessions();
          }
          return RefreshIndicator(
            onRefresh: _reload,
            child: FutureBuilder<List<ServerEventSession>>(
              future: _server,
              builder: (context, snapshot) => ListView(
                padding: const EdgeInsets.all(AppSpacing.s4),
                children: [
                  const _BackupActions(),
                  const SizedBox(height: AppSpacing.s4),
                  if (local.isNotEmpty) ...[
                    _SectionTitle('기기에 보관 중 (${local.length})'),
                    for (final backup in local) _LocalCard(backup: backup),
                    const SizedBox(height: AppSpacing.s4),
                  ],
                  ..._serverSection(context, snapshot, hasLocal: local.isNotEmpty),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  List<Widget> _serverSection(
    BuildContext context,
    AsyncSnapshot<List<ServerEventSession>> snapshot, {
    required bool hasLocal,
  }) {
    if (snapshot.connectionState != ConnectionState.done) {
      return [const _SectionTitle('서버에 저장된 기록'), for (var i = 0; i < 3; i++) const _SkeletonCard()];
    }
    if (snapshot.hasError) {
      return [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.s6),
            child: StatusMessage(
              icon: Icons.cloud_off,
              iconColor: AppColors.critical,
              title: eventsLoadFailedMessage,
              actions: [FilledButton(onPressed: _reload, child: const Text('다시 시도'))],
            ),
          ),
        ),
      ];
    }
    final sessions = snapshot.data ?? const [];
    if (sessions.isEmpty && !hasLocal) {
      return [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.s6),
            child: StatusMessage(
              icon: Icons.inventory_2_outlined,
              title: noEventsTitle,
              message: noEventsMessage,
              actions: [
                OutlinedButton(
                  onPressed: () => runEventBackup(context, BackupKind.suddenBrakeSimulation),
                  child: const Text('사고 기록 시뮬레이션 실행'),
                ),
              ],
            ),
          ),
        ),
      ];
    }
    return [
      _SectionTitle('서버에 저장된 기록 (${sessions.length})'),
      if (sessions.isNotEmpty)
        Text('배정 차량: ${sessions.first.plateNumber}', style: Theme.of(context).textTheme.bodySmall),
      const SizedBox(height: AppSpacing.s2),
      for (final session in sessions) _ServerCard(session: session),
    ];
  }
}

class _BackupActions extends StatelessWidget {
  const _BackupActions();

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.s4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('사고 기록 남기기', style: text.titleMedium),
            const SizedBox(height: AppSpacing.s1),
            Text(
              keepAll('이상 조작이 느껴지면 긴급 백업을 누르세요. 직전 30초와 이후 30초 기록을 기기에 먼저 보관하고, 연결되면 서버에서 무결성을 검증합니다.'),
              style: text.bodyMedium?.copyWith(color: AppColors.textMuted),
            ),
            const SizedBox(height: AppSpacing.s3),
            FilledButton.icon(
              onPressed: () => runEventBackup(context, BackupKind.manual),
              icon: const Icon(Icons.shield_outlined),
              label: const Text('긴급 백업'),
            ),
            const SizedBox(height: AppSpacing.s2),
            OutlinedButton.icon(
              onPressed: () => runEventBackup(context, BackupKind.suddenBrakeSimulation),
              icon: const Icon(Icons.science_outlined),
              label: const Text('급제동 시뮬레이션'),
            ),
            const SizedBox(height: AppSpacing.s1),
            Text('실물 단말 연결 전에는 모의 기록기로 60초 기록을 만듭니다.', style: text.bodySmall),
          ],
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: AppSpacing.s2),
    child: Text(text, style: Theme.of(context).textTheme.titleMedium),
  );
}

class _EventCard extends StatelessWidget {
  const _EventCard({
    required this.title,
    required this.subtitle,
    required this.badge,
    required this.onTap,
    this.footer,
  });

  final String title;
  final String subtitle;
  final Widget badge;
  final String? footer;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.s2),
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.s3),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title, style: text.bodyLarge?.copyWith(fontWeight: FontWeight.w600)),
                      Text(subtitle, style: text.bodySmall),
                      const SizedBox(height: AppSpacing.s2),
                      badge,
                      if (footer != null) ...[
                        const SizedBox(height: AppSpacing.s1),
                        Text(keepAll(footer!), style: text.bodySmall),
                      ],
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right, color: AppColors.textMuted),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ServerCard extends StatelessWidget {
  const _ServerCard({required this.session});
  final ServerEventSession session;

  @override
  Widget build(BuildContext context) => _EventCard(
    title: session.triggerType.label,
    subtitle: '${formatKst(session.startTime)} · ${formatCount(session.recordCount)}개 · 서버 동기화 완료',
    badge: IntegrityBadge.server(verified: session.integrityVerified),
    onTap: () => context.go('/records/${session.id}'),
  );
}

class _LocalCard extends StatelessWidget {
  const _LocalCard({required this.backup});
  final LocalEventBackup backup;

  @override
  Widget build(BuildContext context) => _EventCard(
    title: backup.triggerType.label,
    subtitle:
        '${formatKst(DateTime.fromMillisecondsSinceEpoch(backup.startTimeMs))} · ${formatCount(backup.recordCount)}개 · 로컬 보관 중',
    badge: IntegrityBadge.local(backup),
    footer: backup.errorMessage,
    onTap: () => context.go('/records/local-${backup.localId}'),
  );
}

class _SkeletonCard extends StatelessWidget {
  const _SkeletonCard();

  @override
  Widget build(BuildContext context) {
    Widget block(double w, double h) => Container(
      width: w,
      height: h,
      decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(AppRadius.md)),
    );
    return Semantics(
      label: '사고 기록을 불러오는 중',
      child: Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.s2),
        child: Card(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.s3),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                block(120, 18),
                const SizedBox(height: AppSpacing.s2),
                block(200, 14),
                const SizedBox(height: AppSpacing.s2),
                block(110, 22),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
