import 'dart:async';

import 'package:material_ui/material_ui.dart';
import 'package:go_router/go_router.dart';

import 'app_scope.dart';
import 'core/feedback/warning_feedback.dart';
import 'core/router/app_router.dart';
import 'core/sensor/pedal_sensor_source.dart';
import 'core/theme/app_theme.dart';
import 'core/ble/ble_transport.dart';
import 'features/auth/application/session_controller.dart';
import 'features/device/application/device_link_controller.dart';
import 'features/device/data/sensor_mode_store.dart';
import 'features/auth/data/auth_repository.dart';
import 'features/auth/data/invite_repository.dart';
import 'features/calibration/data/device_repository.dart';
import 'features/events/application/event_sync_controller.dart';
import 'features/events/data/driver_events_repository.dart';
import 'features/home/data/driver_home_repository.dart';

class PedalEyeApp extends StatefulWidget {
  const PedalEyeApp({
    super.key,
    required this.session,
    required this.auth,
    required this.invites,
    required this.home,
    required this.devices,
    required this.sensorFactory,
    required this.warningFeedback,
    required this.events,
    required this.eventSync,
    required this.webConsoleUrl,
    this.deviceLink,
    this.sensorMode,
    this.transportFor,
  });

  final SessionController session;
  final AuthRepository auth;
  final InviteRepository invites;
  final DriverHomeRepository home;
  final DeviceRepository devices;
  final PedalSensorFactory sensorFactory;
  final WarningFeedback warningFeedback;
  final DriverEventsRepository events;
  final EventSyncController eventSync;
  final Uri webConsoleUrl;
  final DeviceLinkController? deviceLink;
  final SensorModeStore? sensorMode;

  /// 센서 방식별 BLE 전송(실제 블루투스·가상 단말)
  final BleTransport Function(SensorMode mode)? transportFor;

  @override
  State<PedalEyeApp> createState() => _PedalEyeAppState();
}

class _PedalEyeAppState extends State<PedalEyeApp> {
  late final GoRouter _router = createRouter(widget.session);

  @override
  void initState() {
    super.initState();
    widget.session.addListener(_bindBackups);
    _bindBackups();
    widget.session.addListener(_bindDeviceLink);
    widget.sensorMode?.addListener(_onSensorModeChanged);
    _bindDeviceLink();
  }

  // 운전자로 로그인했고 BLE·가상 단말 모드일 때만 단말에 연결한다
  void _bindDeviceLink() {
    final link = widget.deviceLink;
    final mode = widget.sensorMode?.mode ?? SensorMode.mock;
    if (link == null) return;
    if (widget.session.status == SessionStatus.driver && mode != SensorMode.mock) {
      link.start();
    } else {
      unawaited(link.stop());
    }
  }

  Future<void> _onSensorModeChanged() async {
    final link = widget.deviceLink;
    final mode = widget.sensorMode?.mode ?? SensorMode.mock;
    final transportFor = widget.transportFor;
    if (link != null && transportFor != null && mode != SensorMode.mock) {
      await link.replaceTransport(transportFor(mode));
    }
    _bindDeviceLink();
  }

  // 기기 백업·자동 업로드는 로그인한 운전자 기준으로 묶는다(다른 계정이 로그인하면 보이지 않음)
  void _bindBackups() {
    final userId = widget.session.userId;
    if (widget.session.status == SessionStatus.driver && userId != null) {
      unawaited(widget.eventSync.bind(userId));
    } else if (widget.session.status == SessionStatus.signedOut) {
      unawaited(widget.eventSync.unbind());
    }
  }

  @override
  void dispose() {
    widget.session.removeListener(_bindBackups);
    widget.session.removeListener(_bindDeviceLink);
    widget.sensorMode?.removeListener(_onSensorModeChanged);
    _router.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AppScope(
      session: widget.session,
      auth: widget.auth,
      invites: widget.invites,
      home: widget.home,
      devices: widget.devices,
      sensorFactory: widget.sensorFactory,
      warningFeedback: widget.warningFeedback,
      events: widget.events,
      eventSync: widget.eventSync,
      webConsoleUrl: widget.webConsoleUrl,
      deviceLink: widget.deviceLink,
      sensorMode: widget.sensorMode,
      child: MaterialApp.router(
        title: '페달아이',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.light(),
        locale: const Locale('ko', 'KR'),
        supportedLocales: const [Locale('ko', 'KR')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        routerConfig: _router,
      ),
    );
  }
}
