import 'package:flutter/widgets.dart';

import 'core/feedback/warning_feedback.dart';
import 'core/sensor/pedal_sensor_source.dart';
import 'features/auth/application/session_controller.dart';
import 'features/auth/data/auth_repository.dart';
import 'features/auth/data/invite_repository.dart';
import 'features/calibration/data/device_repository.dart';
import 'features/events/application/event_sync_controller.dart';
import 'features/events/data/driver_events_repository.dart';
import 'features/home/data/driver_home_repository.dart';

/// 화면이 쓰는 의존성 묶음. 테스트에서는 가짜 저장소로 바꿔 끼운다.
class AppScope extends InheritedWidget {
  const AppScope({
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
    required super.child,
  });

  final SessionController session;
  final AuthRepository auth;
  final InviteRepository invites;
  final DriverHomeRepository home;
  final DeviceRepository devices;

  /// 지금은 모의 센서, 단말 규격이 정해지면 BLE 센서를 만든다
  final PedalSensorFactory sensorFactory;
  final WarningFeedback warningFeedback;
  final DriverEventsRepository events;
  final EventSyncController eventSync;
  final Uri webConsoleUrl;

  static AppScope of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<AppScope>();
    assert(scope != null, 'AppScope 가 위젯 트리에 없습니다.');
    return scope!;
  }

  /// initState 처럼 구독하면 안 되는 곳에서 읽을 때
  static AppScope read(BuildContext context) {
    final scope = context.getInheritedWidgetOfExactType<AppScope>();
    assert(scope != null, 'AppScope 가 위젯 트리에 없습니다.');
    return scope!;
  }

  @override
  bool updateShouldNotify(AppScope oldWidget) =>
      session != oldWidget.session ||
      auth != oldWidget.auth ||
      invites != oldWidget.invites ||
      home != oldWidget.home ||
      devices != oldWidget.devices;
}
