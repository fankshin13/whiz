import 'package:material_ui/material_ui.dart';
import 'package:go_router/go_router.dart';

import 'app_scope.dart';
import 'core/feedback/warning_feedback.dart';
import 'core/router/app_router.dart';
import 'core/sensor/pedal_sensor_source.dart';
import 'core/theme/app_theme.dart';
import 'features/auth/application/session_controller.dart';
import 'features/auth/data/auth_repository.dart';
import 'features/auth/data/invite_repository.dart';
import 'features/calibration/data/device_repository.dart';
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
    required this.webConsoleUrl,
  });

  final SessionController session;
  final AuthRepository auth;
  final InviteRepository invites;
  final DriverHomeRepository home;
  final DeviceRepository devices;
  final PedalSensorFactory sensorFactory;
  final WarningFeedback warningFeedback;
  final Uri webConsoleUrl;

  @override
  State<PedalEyeApp> createState() => _PedalEyeAppState();
}

class _PedalEyeAppState extends State<PedalEyeApp> {
  late final GoRouter _router = createRouter(widget.session);

  @override
  void dispose() {
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
      webConsoleUrl: widget.webConsoleUrl,
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
