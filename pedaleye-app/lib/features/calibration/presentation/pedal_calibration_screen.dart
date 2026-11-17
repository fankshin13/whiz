import 'dart:async';

import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../../app_scope.dart';
import '../../../core/ble/ble_protocol.dart' show CalibrationValues;
import '../../../core/calibration/calibration_wizard_state_machine.dart';
import '../../../core/sensor/ble_pedal_sensor_source.dart';
import '../../../core/sensor/mock_pedal_sensor_source.dart';
import '../../../core/sensor/pedal_sensor_source.dart';
import '../../../core/telemetry/displacement_engine.dart';
import '../../../core/telemetry/pedal_calculator.dart';
import '../../../core/text/keep_all.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/busy_button.dart';
import '../../../core/widgets/form_error.dart';
import '../../../core/widgets/screen_body.dart';
import '../../../core/widgets/status_message.dart';
import '../../device/application/device_link_controller.dart';
import '../../gauge/presentation/mock_sensor_panel.dart';
import '../../gauge/presentation/pedal_gauge_widgets.dart';
import '../data/device_repository.dart';
import '../domain/driver_device.dart';

const loadingDeviceMessage = '단말기 보정 정보를 불러오는 중입니다...';
const noCalibrationDeviceMessage = '배정된 페달아이 단말기를 찾을 수 없습니다.';
const calibrationSavedMessage = '페달 캘리브레이션이 완료되었습니다.';
const calibrationSaveFailedMessage = '보정값 저장에 실패했습니다. 네트워크 상태를 확인해주세요.';

/// 4단계 페달 캘리브레이션: 가속 0% → 가속 100% → 제동 0% → 제동 100% → 반응 확인 → 저장
class PedalCalibrationScreen extends StatefulWidget {
  const PedalCalibrationScreen({super.key});

  @override
  State<PedalCalibrationScreen> createState() => _PedalCalibrationScreenState();
}

class _PedalCalibrationScreenState extends State<PedalCalibrationScreen> {
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
      appBar: AppBar(title: const Text('페달 보정')),
      body: FutureBuilder<DriverDevice?>(
        future: _device,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return Center(
              child: Semantics(
                liveRegion: true,
                label: loadingDeviceMessage,
                child: const Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    CircularProgressIndicator(),
                    SizedBox(height: AppSpacing.s4),
                    ExcludeSemantics(child: Text(loadingDeviceMessage)),
                  ],
                ),
              ),
            );
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
                  title: noCalibrationDeviceMessage,
                  message: '소속 관리자에게 단말기 장착·배정을 요청해 주세요.',
                  actions: [OutlinedButton(onPressed: () => context.go('/home'), child: const Text('홈으로 돌아가기'))],
                ),
              ],
            );
          }
          return _CalibrationWizard(device: device);
        },
      ),
    );
  }
}

class _CalibrationWizard extends StatefulWidget {
  const _CalibrationWizard({required this.device});
  final DriverDevice device;

  @override
  State<_CalibrationWizard> createState() => _CalibrationWizardState();
}

class _CalibrationWizardState extends State<_CalibrationWizard> {
  late final PedalSensorSource _source;
  late final StreamSubscription<RawPedalSample> _subscription;
  final _latest = ValueNotifier<RawPedalSample?>(null);
  WizardState _state = WizardState.initial;

  // 3초 수집
  final _samples = <int>[];
  Pedal? _collecting;
  Timer? _captureTimer;
  final _elapsed = ValueNotifier<double>(0);
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _source = AppScope.read(context).sensorFactory();
    _subscription = _source.sampleStream.listen(_onSample);
    unawaited(_source.initialize().then((_) => _source.start()));
  }

  @override
  void dispose() {
    _captureTimer?.cancel();
    unawaited(_subscription.cancel());
    unawaited(_source.dispose());
    _latest.dispose();
    _elapsed.dispose();
    super.dispose();
  }

  void _onSample(RawPedalSample sample) {
    _latest.value = sample;
    final pedal = _collecting;
    if (pedal != null) _samples.add(pedal == Pedal.accel ? sample.accelRawDistance : sample.brakeRawDistance);
  }

  void _startCapture() {
    final step = _state.step;
    if (step == null) return;
    _samples.clear();
    _elapsed.value = 0;
    setState(() => _collecting = step.pedal);
    // 0.1초 간격 타이머의 횟수로 경과 시간을 센다
    _captureTimer = Timer.periodic(const Duration(milliseconds: 100), (timer) {
      final elapsed = timer.tick / 10;
      if (elapsed < captureSeconds) {
        _elapsed.value = elapsed;
        return;
      }
      timer.cancel();
      final next = applyCapture(_state, summarizeSamples(List.of(_samples)));
      if (next.stepIndex > _state.stepIndex) unawaited(HapticFeedback.mediumImpact());
      setState(() {
        _collecting = null;
        _state = next;
      });
    });
  }

  void _restart() {
    _captureTimer?.cancel();
    setState(() {
      _collecting = null;
      _state = WizardState.initial;
    });
  }

  Future<void> _save(CalibrationPayload payload) async {
    setState(() => _saving = true);
    final scope = AppScope.of(context);
    // BLE 단말이면 먼저 단말에 쓰고, 성공했을 때만 서버에 저장한다(단말·서버 기준값 불일치 방지)
    if (_source case final BlePedalSensorSource ble) {
      try {
        await ble.link.writeCalibration(
          CalibrationValues(
            accelMin: payload.accelCalibMin,
            accelMax: payload.accelCalibMax,
            brakeMin: payload.brakeCalibMin,
            brakeMax: payload.brakeCalibMax,
          ),
        );
      } on CalibrationWriteException catch (error) {
        if (!mounted) return;
        setState(() => _saving = false);
        final retry = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('단말 저장 실패'),
            content: Text(error.message),
            actions: [
              TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('닫기')),
              FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('다시 시도')),
            ],
          ),
        );
        if (retry == true && mounted) await _save(payload);
        return;
      }
      if (!mounted) return;
    }
    try {
      await scope.devices.saveCalibration(payload);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text(calibrationSavedMessage)));
      context.go('/gauge');
    } on CalibrationSaveException catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      final retry = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('저장 실패'),
          content: Text(switch (error.failure) {
            CalibrationSaveFailure.network => calibrationSaveFailedMessage,
            CalibrationSaveFailure.forbidden => '이 단말의 보정값을 변경할 권한이 없습니다. 관리자에게 문의해 주세요.',
            CalibrationSaveFailure.invalidStroke => '페달 가동 범위가 너무 작습니다(최소 5mm 이상 필요). 처음부터 다시 측정해 주세요.',
          }),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('닫기')),
            if (error.failure == CalibrationSaveFailure.network)
              FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('다시 시도')),
          ],
        ),
      );
      if (retry == true && mounted) await _save(payload);
    }
  }

  @override
  Widget build(BuildContext context) {
    final payload = toCalibrationPayload(widget.device.deviceId, _state);
    return ScreenBody(
      children: [
        Text(
          '${widget.device.plateNumber} · ${widget.device.serialNumber}',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: AppSpacing.s3),
        _StepList(state: _state),
        const SizedBox(height: AppSpacing.s4),
        if (payload == null) _captureCard(context) else _completeCard(context, payload),
        if (_source case final MockPedalSensorSource mock) ...[
          const SizedBox(height: AppSpacing.s4),
          MockSensorPanel(source: mock),
        ],
      ],
    );
  }

  Widget _captureCard(BuildContext context) {
    final step = _state.step!;
    final text = Theme.of(context).textTheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.s4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('${_state.stepIndex + 1}단계: ${step.title}', style: text.titleMedium),
            const SizedBox(height: AppSpacing.s2),
            Text(keepAll(step.instruction), style: text.bodyLarge),
            const SizedBox(height: AppSpacing.s3),
            ValueListenableBuilder<RawPedalSample?>(
              valueListenable: _latest,
              builder: (context, sample, _) {
                final distance = sample == null
                    ? null
                    : (step.pedal == Pedal.accel ? sample.accelRawDistance : sample.brakeRawDistance);
                return Text(
                  '현재 센서 거리  ${distance == null ? '측정 대기' : '${formatMillimeters(distance)}mm'}',
                  style: text.bodyMedium?.copyWith(color: AppColors.textMuted),
                );
              },
            ),
            const SizedBox(height: AppSpacing.s3),
            if (_state.error != null) ...[FormError(_state.error!), const SizedBox(height: AppSpacing.s3)],
            if (_collecting != null)
              _Countdown(elapsed: _elapsed)
            else
              FilledButton.icon(
                onPressed: _startCapture,
                icon: const Icon(Icons.timer_outlined),
                label: Text(_state.error != null ? '다시 측정' : '측정 시작 ($captureSeconds초)'),
              ),
          ],
        ),
      ),
    );
  }

  Widget _completeCard(BuildContext context, CalibrationPayload payload) {
    final text = Theme.of(context).textTheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.s4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('보정 완료', style: text.titleMedium),
            const SizedBox(height: AppSpacing.s2),
            Text(keepAll('페달을 밟아 0%에서 100%까지 숫자가 자연스럽게 바뀌는지 확인한 뒤 적용해 주세요.'), style: text.bodyLarge),
            const SizedBox(height: AppSpacing.s3),
            Wrap(
              spacing: AppSpacing.s6,
              runSpacing: AppSpacing.s2,
              children: [
                _Metric(label: '가속 행정', value: '${formatMillimeters(payload.accelStroke)}mm'),
                _Metric(label: '제동 행정', value: '${formatMillimeters(payload.brakeStroke)}mm'),
              ],
            ),
            const SizedBox(height: AppSpacing.s3),
            RepaintBoundary(
              child: ValueListenableBuilder<RawPedalSample?>(
                valueListenable: _latest,
                builder: (context, sample, _) {
                  final accel = sample == null
                      ? 0
                      : calculatePedalPercentage(sample.accelRawDistance, payload.accelCalibMin, payload.accelCalibMax);
                  final brake = sample == null
                      ? 0
                      : calculatePedalPercentage(sample.brakeRawDistance, payload.brakeCalibMin, payload.brakeCalibMax);
                  return Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: PedalLevelGauge(
                          pedal: GaugePedal.brake,
                          percent: brake,
                          litLevel: calculatePedalLevel(brake),
                          compact: true,
                        ),
                      ),
                      const SizedBox(width: AppSpacing.s3),
                      Expanded(
                        child: PedalLevelGauge(
                          pedal: GaugePedal.accel,
                          percent: accel,
                          litLevel: calculatePedalLevel(accel),
                          compact: true,
                        ),
                      ),
                    ],
                  );
                },
              ),
            ),
            const SizedBox(height: AppSpacing.s4),
            BusyButton(label: '보정값 적용하기', busyLabel: '저장 중', busy: _saving, onPressed: () => _save(payload)),
            const SizedBox(height: AppSpacing.s2),
            OutlinedButton.icon(
              onPressed: _saving ? null : _restart,
              icon: const Icon(Icons.restart_alt),
              label: const Text('처음부터 다시'),
            ),
          ],
        ),
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(label, style: text.bodySmall),
        Text(value, style: text.titleMedium?.copyWith(fontFeatures: const [FontFeature.tabularFigures()])),
      ],
    );
  }
}

/// 4단계 진행 표시: 완료·진행 중·대기를 글자로도 보여 준다
class _StepList extends StatelessWidget {
  const _StepList({required this.state});
  final WizardState state;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      children: [
        for (final (index, step) in wizardSteps.indexed)
          Builder(
            builder: (context) {
              final done = index < state.stepIndex;
              final current = index == state.stepIndex;
              final captured = state.captured[step.key];
              return Container(
                margin: const EdgeInsets.only(bottom: AppSpacing.s1),
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s3, vertical: AppSpacing.s2),
                decoration: BoxDecoration(
                  color: current ? AppColors.bgBase : AppColors.bgPanel,
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  border: Border.all(color: current ? AppColors.primaryAction : AppColors.border),
                ),
                child: Row(
                  children: [
                    Icon(
                      done ? Icons.check_circle : (current ? Icons.radio_button_checked : Icons.radio_button_unchecked),
                      size: 20,
                      color: done ? AppColors.accel : AppColors.textMuted,
                    ),
                    const SizedBox(width: AppSpacing.s2),
                    Expanded(
                      child: Text(
                        '${index + 1}단계 · ${step.title}',
                        style: text.bodyMedium?.copyWith(fontWeight: current ? FontWeight.w600 : FontWeight.w400),
                      ),
                    ),
                    Text(
                      captured != null ? '${formatMillimeters(captured)}mm' : (current ? '진행 중' : '대기'),
                      style: text.bodySmall?.copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
                    ),
                  ],
                ),
              );
            },
          ),
      ],
    );
  }
}

class _Countdown extends StatelessWidget {
  const _Countdown({required this.elapsed});
  final ValueNotifier<double> elapsed;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<double>(
      valueListenable: elapsed,
      builder: (context, value, _) {
        final remaining = (captureSeconds - value).ceil().clamp(1, captureSeconds);
        return Semantics(
          liveRegion: true,
          label: '측정 중, $remaining초 남음. 자세를 유지해 주세요',
          child: ExcludeSemantics(
            child: Row(
              children: [
                SizedBox.square(
                  dimension: 48,
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      CircularProgressIndicator(value: value / captureSeconds, strokeWidth: 5),
                      Text('$remaining', style: Theme.of(context).textTheme.titleMedium),
                    ],
                  ),
                ),
                const SizedBox(width: AppSpacing.s3),
                const Expanded(child: Text('측정 중... 자세를 유지해 주세요')),
              ],
            ),
          ),
        );
      },
    );
  }
}
