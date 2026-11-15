import 'dart:typed_data';

import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../app_scope.dart';
import '../../../core/forensics/hash_chain.dart';
import '../../../core/forensics/packet_codec.dart';
import '../../../core/text/keep_all.dart';
import '../../../core/text/kst_format.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/busy_button.dart';
import '../../../core/widgets/form_error.dart';
import '../../../core/widgets/screen_body.dart';
import '../../../core/widgets/status_message.dart';
import '../domain/event_models.dart';
import 'event_widgets.dart';
import 'pedal_timeline_chart.dart';

const eventNotFoundMessage = '사고 기록을 찾을 수 없거나 열람 권한이 없습니다.';

/// 사고 기록 상세. id 가 'local-…' 이면 기기 백업, 아니면 서버 세션.
class DriverEventDetailScreen extends StatefulWidget {
  const DriverEventDetailScreen({super.key, required this.id});
  final String id;

  @override
  State<DriverEventDetailScreen> createState() => _DriverEventDetailScreenState();
}

/// 화면에 그릴 내용: 서버 세션 또는 기기 백업 + 원본 패킷
class _Detail {
  const _Detail({this.server, this.local, required this.packets, required this.localCheck});
  final ServerEventSession? server;
  final LocalEventBackup? local;
  final List<PacketRecord> packets;

  /// 기기에서 다시 계산한 체인(참고용. 판정은 서버 값)
  final HashChainVerificationResult localCheck;
}

class _DriverEventDetailScreenState extends State<DriverEventDetailScreen> {
  Future<_Detail?>? _detail;
  bool _uploading = false;
  String? _uploadError;

  String? get _localId => widget.id.startsWith('local-') ? widget.id.substring(6) : null;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _detail ??= _load();
  }

  Future<_Detail?> _load() async {
    final scope = AppScope.of(context);
    final userId = scope.session.userId;
    if (userId == null) return null;
    final localId = _localId;
    if (localId != null) {
      final backup = scope.eventSync.backups.where((b) => b.localId == localId).firstOrNull;
      if (backup == null) return null;
      return _parse(await scope.eventSync.store.readBytes(userId, localId), local: backup);
    }
    final session = await scope.events.getSession(widget.id);
    if (session == null) return null;
    return _parse(await scope.events.downloadLog(session), server: session);
  }

  _Detail _parse(Uint8List bytes, {ServerEventSession? server, LocalEventBackup? local}) =>
      _Detail(server: server, local: local, packets: decodeAllPackets(bytes), localCheck: verifyBinaryHashChain(bytes));

  Future<void> _upload(LocalEventBackup backup) async {
    setState(() {
      _uploading = true;
      _uploadError = null;
    });
    final result = await AppScope.of(context).eventSync.uploadNow(backup.localId);
    if (!mounted) return;
    setState(() => _uploading = false);
    final serverId = result?.serverSessionId;
    if (result?.status == UploadStatus.completed && serverId != null) {
      context.go('/records/$serverId');
    } else {
      setState(() {
        _uploadError = result?.errorMessage ?? '서버에 연결하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요. 기록은 기기에 그대로 보관됩니다.';
      });
    }
  }

  Future<void> _openReport(String sessionId) async {
    final base = AppScope.of(context).webConsoleUrl;
    final url = base.replace(path: '${base.path}/events/$sessionId/report');
    final opened = await launchUrl(url, mode: LaunchMode.externalApplication);
    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('브라우저를 열지 못했습니다. 주소: $url')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('사고 기록 상세'),
        leading: IconButton(
          tooltip: '목록으로',
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/records'),
        ),
      ),
      body: FutureBuilder<_Detail?>(
        future: _detail,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator(semanticsLabel: '사고 기록을 불러오는 중'));
          }
          if (snapshot.hasError) {
            return ScreenBody(
              center: true,
              children: [
                StatusMessage(
                  icon: Icons.cloud_off,
                  iconColor: AppColors.critical,
                  title: '사고 기록을 불러오지 못했습니다.',
                  message: '네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
                  actions: [
                    FilledButton(
                      onPressed: () => setState(() {
                        _detail = _load();
                      }),
                      child: const Text('다시 시도'),
                    ),
                  ],
                ),
              ],
            );
          }
          final detail = snapshot.data;
          if (detail == null) {
            return ScreenBody(
              center: true,
              children: [
                StatusMessage(
                  icon: Icons.lock_outline,
                  title: eventNotFoundMessage,
                  actions: [OutlinedButton(onPressed: () => context.go('/records'), child: const Text('목록으로'))],
                ),
              ],
            );
          }
          return _content(context, detail);
        },
      ),
    );
  }

  Widget _content(BuildContext context, _Detail d) {
    final text = Theme.of(context).textTheme;
    final server = d.server;
    // 업로드 진행 상황은 동기화 컨트롤러의 최신 값을 쓴다
    final local = d.local == null
        ? null
        : AppScope.of(context).eventSync.backups.where((b) => b.localId == d.local!.localId).firstOrNull ?? d.local;
    final trigger = server?.triggerType ?? local!.triggerType;
    final start = server?.startTime ?? DateTime.fromMillisecondsSinceEpoch(local!.startTimeMs);
    final count = server?.recordCount ?? local!.recordCount;
    final seconds = d.packets.length < 2
        ? 0
        : ((d.packets.last.timestampMs - d.packets.first.timestampMs) / 1000).round();

    return ScreenBody(
      children: [
        Text(trigger.label, style: text.headlineSmall),
        Text(
          '${formatKst(start)} · 패킷 ${formatCount(count)}개 / $seconds초',
          style: text.bodyMedium?.copyWith(color: AppColors.textMuted),
        ),
        const SizedBox(height: AppSpacing.s4),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.s4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('무결성 검증', style: text.titleMedium),
                const SizedBox(height: AppSpacing.s2),
                Align(
                  alignment: Alignment.centerLeft,
                  child: server != null
                      ? IntegrityBadge.server(verified: server.integrityVerified)
                      : IntegrityBadge.local(local!),
                ),
                const SizedBox(height: AppSpacing.s2),
                Text(
                  keepAll(
                    server == null
                        ? '아직 서버 검증 전입니다. 아래 지문은 기기에서 계산한 참고 값이며, 판정은 서버가 원본을 전수 검증해 정합니다.'
                        : server.integrityVerified
                        ? '디지털 증거 무결성 검증 완료: 서버가 원본 ${formatCount(server.recordCount)}개 패킷의 해시 체인을 처음부터 끝까지 다시 계산해 일치를 확인했습니다.'
                        : '변조 감지: 원본의 해시 체인이 끊겨 있습니다. 이 기록은 증거로 쓰기 전에 관리자·조사관 확인이 필요합니다.',
                  ),
                  style: text.bodyMedium,
                ),
                const SizedBox(height: AppSpacing.s3),
                _Fingerprint(label: '최초 해시 지문', value: server?.initialHash ?? d.localCheck.initialHash),
                _Fingerprint(label: '최종 체인 해시 지문', value: server?.finalHash ?? d.localCheck.finalHash),
              ],
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.s4),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.s4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('페달 조작 기록', style: text.titleMedium),
                const SizedBox(height: AppSpacing.s2),
                PedalTimelineChart(packets: d.packets),
              ],
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.s4),
        if (server != null)
          FilledButton.icon(
            onPressed: () => _openReport(server.id),
            icon: const Icon(Icons.picture_as_pdf_outlined),
            label: const Text('PDF 보고서 열기'),
          ),
        if (server != null)
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.s1),
            child: Text(
              keepAll('웹 콘솔에서 열립니다. 처음 한 번은 같은 계정으로 로그인해 주세요. 인쇄 메뉴에서 PDF로 저장할 수 있습니다.'),
              style: text.bodySmall,
            ),
          ),
        if (local != null && local.status != UploadStatus.completed) ...[
          if (_uploadError != null) ...[FormError(_uploadError!), const SizedBox(height: AppSpacing.s3)],
          if (local.errorMessage != null && _uploadError == null) ...[
            FormError(local.errorMessage!),
            const SizedBox(height: AppSpacing.s3),
          ],
          BusyButton(
            label: '서버로 지금 업로드',
            busyLabel: '무결성 검증 요청 중',
            busy: _uploading || local.status == UploadStatus.uploading,
            onPressed: () => _upload(local),
          ),
          if (_uploading || local.status == UploadStatus.uploading)
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.s2),
              child: Text('무결성 검증 요청 중...', style: text.bodySmall, textAlign: TextAlign.center),
            ),
        ],
      ],
    );
  }
}

class _Fingerprint extends StatelessWidget {
  const _Fingerprint({required this.label, required this.value});
  final String label;
  final String? value;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.s2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: text.bodySmall),
          Semantics(
            label: '$label ${value ?? '없음'}',
            child: ExcludeSemantics(
              child: SelectableText(
                shortHash(value),
                style: text.bodyMedium?.copyWith(
                  fontFeatures: const [FontFeature.tabularFigures()],
                  letterSpacing: 0.5,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
