import 'dart:async';

import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app_scope.dart';
import '../../../core/sensor/mock_pedal_sensor_source.dart';
import '../../../core/telemetry/pedal_calculator.dart';
import '../../../core/telemetry/telemetry_controller.dart';
import '../../../core/telemetry/telemetry_frame.dart';
import '../../../core/text/keep_all.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/screen_body.dart';
import '../../../core/widgets/status_message.dart';
import '../../calibration/data/device_repository.dart';
import '../../calibration/domain/driver_device.dart';
import '../../events/presentation/event_widgets.dart';
import 'mock_sensor_panel.dart';
import 'pedal_gauge_widgets.dart';

const sensorLostMessage = '센서 신호가 3초 이상 끊겼습니다. 단말기 전원 및 연결 상태를 확인해주세요.';
const noDeviceMessage = '배정된 페달아이 단말기를 찾을 수 없습니다.';

const _modeLabels = {
  PedalOperationMode.idle: '대기중',
  PedalOperationMode.accel: '가속 중',
  PedalOperationMode.brake: '제동 중',
  PedalOperationMode.dualWarning: '양발 조작',
};

/// 20Hz 실시간 페달 게이지(주행 중 화면). 탭 바 없이 전체 화면을 쓴다.
class PedalGaugeScreen extends StatefulWidget {
  const PedalGaugeScreen({super.key});

  @override
  State<PedalGaugeScreen> createState() => _PedalGaugeScreenState();
}

class _PedalGaugeScreenState extends State<PedalGaugeScreen> {
  Future<DriverDevice?>? _device;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _device ??= _load();
  }

  Future<DriverDevice?> _load() {
    final scope = AppScope.of(context);
    final userId = scope.session.userId;
    if (userId == null) return Future.error(const DeviceLoadException());
    return scope.devices.loadMyDevice(userId);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('실시간 페달 게이지'),
        leading: IconButton(tooltip: '홈으로', icon: const Icon(Icons.arrow_back), onPressed: () => context.go('/home')),
        actions: [
          // 이상 조작을 느끼면 바로 누를 수 있게 상단에 둔다
          Padding(
            padding: const EdgeInsets.only(right: AppSpacing.s2),
            child: FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: AppColors.brake, foregroundColor: AppColors.bgBase),
              onPressed: () => runEventBackup(context, BackupKind.manual),
              icon: const Icon(Icons.shield_outlined, size: 20),
              label: const Text('긴급 백업'),
            ),
          ),
        ],
      ),
      body: FutureBuilder<DriverDevice?>(
        future: _device,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator(semanticsLabel: '단말기 정보를 불러오는 중'));
          }
          if (snapshot.hasError) {
            return ScreenBody(
              center: true,
              children: [
                StatusMessage(
                  icon: Icons.error_outline,
                  iconColor: AppColors.critical,
                  title: '단말기 정보를 불러올 수 없습니다.',
                  message: '네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
                  actions: [
                    FilledButton(
                      onPressed: () => setState(() {
                        _device = _load();
                      }),
                      child: const Text('다시 시도'),
                    ),
                  ],
                ),
              ],
            );
          }
          final device = snapshot.data;
          if (device == null) {
            return ScreenBody(
              center: true,
              children: [
                StatusMessage(
                  icon: Icons.sensors_off,
                  title: noDeviceMessage,
                  message: '소속 관리자에게 단말기 장착·배정을 요청해 주세요.',
                  actions: [OutlinedButton(onPressed: () => context.go('/home'), child: const Text('홈으로 돌아가기'))],
                ),
              ],
            );
          }
          if (!device.isCalibrated) {
            return ScreenBody(
              center: true,
              children: [
                StatusMessage(
                  icon: Icons.tune,
                  title: '먼저 페달 보정을 진행해 주세요.',
                  message: '보정값이 없으면 페달을 얼마나 밟았는지 계산할 수 없습니다.',
                  actions: [FilledButton(onPressed: () => context.go('/calibrate'), child: const Text('페달 보정 시작하기'))],
                ),
              ],
            );
          }
          return _LiveGauge(device: device);
        },
      ),
    );
  }
}

class _LiveGauge extends StatefulWidget {
  const _LiveGauge({required this.device});
  final DriverDevice device;

  @override
  State<_LiveGauge> createState() => _LiveGaugeState();
}

class _LiveGaugeState extends State<_LiveGauge> {
  late final TelemetryController _controller;
  Timer? _pulse;
  bool _reconnecting = false;

  @override
  void initState() {
    super.initState();
    final scope = AppScope.read(context);
    _controller = TelemetryController(source: scope.sensorFactory(), calibration: widget.device.calibration);
    _controller.frame.addListener(_onFrame);
    unawaited(_controller.start());
  }

  // 양발 조작 동안 0.6초마다 진동·경고음 반복
  void _onFrame() {
    final dual = _controller.frame.value?.isDualPressed ?? false;
    if (dual && _pulse == null) {
      final feedback = AppScope.read(context).warningFeedback;
      unawaited(feedback.dualPressPulse());
      _pulse = Timer.periodic(const Duration(milliseconds: 600), (_) => unawaited(feedback.dualPressPulse()));
    } else if (!dual && _pulse != null) {
      _pulse?.cancel();
      _pulse = null;
    }
  }

  Future<void> _reconnect() async {
    setState(() => _reconnecting = true);
    await _controller.reconnect();
    if (mounted) setState(() => _reconnecting = false);
  }

  @override
  void dispose() {
    _pulse?.cancel();
    _controller.frame.removeListener(_onFrame);
    unawaited(_controller.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final source = _controller.source;
    return Stack(
      children: [
        ScreenBody(
          children: [
            Text(
              '${widget.device.plateNumber} · ${widget.device.serialNumber}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: AppSpacing.s2),
            // 20Hz 로 바뀌는 부분만 다시 그린다
            RepaintBoundary(
              child: ValueListenableBuilder<TelemetryFrame?>(
                valueListenable: _controller.frame,
                builder: (context, frame, _) => _GaugeBody(frame: frame),
              ),
            ),
            if (source is MockPedalSensorSource) ...[
              const SizedBox(height: AppSpacing.s6),
              MockSensorPanel(source: source, showScenarios: true),
            ],
          ],
        ),
        ValueListenableBuilder<bool>(
          valueListenable: _controller.disconnected,
          builder: (context, lost, _) =>
              lost ? _SensorLostOverlay(busy: _reconnecting, onReconnect: _reconnect) : const SizedBox.shrink(),
        ),
      ],
    );
  }
}

class _GaugeBody extends StatelessWidget {
  const _GaugeBody({required this.frame});
  final TelemetryFrame? frame;

  @override
  Widget build(BuildContext context) {
    final f = frame;
    final mode = f?.mode ?? PedalOperationMode.idle;
    final dual = f?.isDualPressed ?? false;
    final led = f == null ? null : toLedPacket(f);
    int lit(int bits) => bits.bitLength; // 아래쪽부터 켜진 칸 수
    return Container(
      padding: const EdgeInsets.all(AppSpacing.s2),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: dual ? AppColors.dualWarning : Colors.transparent, width: 4),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: _ModeBadge(mode: mode, waiting: f == null),
          ),
          const SizedBox(height: AppSpacing.s3),
          if (dual) ...[const DualWarningBanner(), const SizedBox(height: AppSpacing.s3)],
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // 실제 차량 배치처럼 왼쪽 제동, 오른쪽 가속
              Expanded(
                child: PedalLevelGauge(
                  pedal: GaugePedal.brake,
                  percent: f?.brakePercent ?? 0,
                  litLevel: led == null ? 0 : lit(led.brakeBits),
                  dual: dual,
                ),
              ),
              const SizedBox(width: AppSpacing.s3),
              Expanded(
                child: PedalLevelGauge(
                  pedal: GaugePedal.accel,
                  percent: f?.accelPercent ?? 0,
                  litLevel: led == null ? 0 : lit(led.accelBits),
                  dual: dual,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ModeBadge extends StatelessWidget {
  const _ModeBadge({required this.mode, required this.waiting});
  final PedalOperationMode mode;
  final bool waiting;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (mode) {
      PedalOperationMode.accel => (AppColors.accel, AppColors.primaryActionFg),
      PedalOperationMode.brake => (AppColors.brakeBg, AppColors.critical),
      PedalOperationMode.dualWarning => (AppColors.dualWarning, AppColors.textMain),
      PedalOperationMode.idle => (AppColors.bgPanel, AppColors.textMain),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s4, vertical: AppSpacing.s2),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: mode == PedalOperationMode.idle ? AppColors.borderStrong : bg),
      ),
      child: Text(
        waiting ? '센서 연결 중' : _modeLabels[mode]!,
        style: TextStyle(color: fg, fontWeight: FontWeight.w700, fontSize: 16),
      ),
    );
  }
}

class _SensorLostOverlay extends StatelessWidget {
  const _SensorLostOverlay({required this.busy, required this.onReconnect});
  final bool busy;
  final VoidCallback onReconnect;

  @override
  Widget build(BuildContext context) {
    return Positioned.fill(
      child: ColoredBox(
        color: AppColors.textMain.withValues(alpha: 0.6),
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.s4),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: AppSizes.contentMaxWidth),
              child: Card(
                color: AppColors.bgBase,
                child: Padding(
                  padding: const EdgeInsets.all(AppSpacing.s6),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Icon(Icons.sensors_off, size: 40, color: AppColors.critical),
                      const SizedBox(height: AppSpacing.s3),
                      Semantics(
                        liveRegion: true,
                        child: Text(
                          keepAll(sensorLostMessage),
                          style: Theme.of(context).textTheme.bodyLarge,
                          textAlign: TextAlign.center,
                        ),
                      ),
                      const SizedBox(height: AppSpacing.s4),
                      FilledButton.icon(
                        onPressed: busy ? null : onReconnect,
                        icon: const Icon(Icons.refresh),
                        label: const Text('센서 재연결'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
