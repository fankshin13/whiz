import 'dart:io';

import 'package:material_ui/material_ui.dart';
import 'package:path_provider/path_provider.dart';

import 'app.dart';
import 'core/config/app_config.dart';
import 'core/feedback/warning_feedback.dart';
import 'core/network/device_connectivity.dart';
import 'core/network/supabase_client.dart';
import 'core/ble/ble_transport.dart';
import 'core/ble/flutter_blue_transport.dart';
import 'core/ble/virtual_pedaleye_device.dart';
import 'core/sensor/ble_pedal_sensor_source.dart';
import 'core/sensor/mock_pedal_sensor_source.dart';
import 'core/theme/app_theme.dart';
import 'features/auth/application/session_controller.dart';
import 'features/auth/data/auth_repository.dart';
import 'features/auth/data/invite_repository.dart';
import 'features/calibration/data/device_repository.dart';
import 'features/device/application/device_link_controller.dart';
import 'features/device/data/sensor_mode_store.dart';
import 'features/events/application/event_sync_controller.dart';
import 'features/events/data/driver_events_repository.dart';
import 'features/events/data/event_uploader.dart';
import 'features/events/data/local_event_store.dart';
import 'features/home/data/driver_home_repository.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final AppConfig config;
  try {
    config = AppConfig.fromEnvironment();
  } on AppConfigException catch (error) {
    // 개발 중 설정 누락: 조용히 실패하지 않고 화면에 이유를 보여 준다
    runApp(_ConfigErrorApp(message: error.message));
    return;
  }

  final client = await initializeSupabase(config);
  final auth = SupabaseAuthRepository(client);
  final session = SessionController(auth);
  await session.start();

  final documents = await getApplicationDocumentsDirectory();
  final eventSync = EventSyncController(
    store: LocalEventStore(Directory('${documents.path}/events')),
    uploader: HttpEventUploader(
      baseUrl: config.webApiBaseUrl,
      accessToken: () async {
        var current = client.auth.currentSession;
        if (current != null && current.isExpired) current = (await client.auth.refreshSession()).session;
        return current?.accessToken;
      },
    ),
    connectivity: DeviceConnectivity(),
  );

  // 센서 방식(개발 설정)과 단말 BLE 연결. 실물 단말 전까지 기본은 모의 센서
  final sensorMode = await SensorModeStore.load(File('${documents.path}/settings/sensor_mode.json'));
  BleTransport transportFor(SensorMode mode) => mode == SensorMode.virtual ? VirtualBleTransport() : FlutterBlueTransport();
  final devices = SupabaseDeviceRepository(client);
  final deviceLink = DeviceLinkController(
    transport: transportFor(sensorMode.mode),
    devices: devices,
    currentUserId: () => session.userId,
  );

  runApp(
    PedalEyeApp(
      session: session,
      auth: auth,
      invites: InviteRepository(baseUrl: config.webApiBaseUrl),
      home: SupabaseDriverHomeRepository(client),
      devices: devices,
      // 화면마다 새 센서: 모의 센서 또는 공유 BLE 연결의 실시간 프레임
      sensorFactory: () => sensorMode.mode == SensorMode.mock ? MockPedalSensorSource() : BlePedalSensorSource(deviceLink),
      warningFeedback: DeviceWarningFeedback(),
      events: SupabaseDriverEventsRepository(client),
      eventSync: eventSync,
      webConsoleUrl: config.webApiBaseUrl,
      deviceLink: deviceLink,
      sensorMode: sensorMode,
      transportFor: transportFor,
    ),
  );
}

class _ConfigErrorApp extends StatelessWidget {
  const _ConfigErrorApp({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      theme: AppTheme.light(),
      home: Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.s4),
            child: Text('앱 설정 오류: $message\n\n.env.example 을 참고해 --dart-define-from-file=.env 로 실행해 주세요.'),
          ),
        ),
      ),
    );
  }
}
