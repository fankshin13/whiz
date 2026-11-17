import 'package:material_ui/material_ui.dart';

import 'package:go_router/go_router.dart';

import '../../../app_scope.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/status_message.dart';
import '../../device/application/device_link_controller.dart';
import '../../device/data/sensor_mode_store.dart';
import '../../device/presentation/device_status_card.dart';
import '../data/driver_home_repository.dart';
import '../domain/driver_home_data.dart';

const noVehicleMessage = '배정된 차량이 없습니다. 소속 관리자에게 차량 배정을 요청해 주세요.';
const homeLoadFailedMessage = '차량 정보를 불러올 수 없습니다.';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Future<DriverHomeData>? _future;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _future ??= _load();
  }

  Future<DriverHomeData> _load() {
    final scope = AppScope.of(context);
    final userId = scope.session.userId;
    if (userId == null) return Future.error(const HomeLoadException());
    return scope.home.load(userId);
  }

  Future<void> _reload() async {
    final next = _load();
    setState(() {
      _future = next;
    });
    try {
      await next;
    } on HomeLoadException {
      // 숨기지 않는다: 같은 Future 를 FutureBuilder 가 받아 오류 안내와 '다시 시도'를 그린다.
      // 여기서는 당겨서 새로고침 표시만 끝낸다.
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<DriverHomeData>(
      future: _future,
      builder: (context, snapshot) {
        final data = snapshot.data;
        final loading = snapshot.connectionState != ConnectionState.done;
        return Scaffold(
          appBar: AppBar(
            toolbarHeight: 64,
            titleSpacing: AppSpacing.s4,
            title: data == null ? const Text('홈') : _DriverTitle(data: data),
            actions: [
              IconButton(tooltip: '로그아웃', icon: const Icon(Icons.logout), onPressed: () => _confirmSignOut(context)),
            ],
          ),
          body: RefreshIndicator(
            onRefresh: _reload,
            child: ListView(
              padding: const EdgeInsets.all(AppSpacing.s4),
              children: [
                if (_deviceLink(context) case final link?) ...[
                  Text('페달아이 단말', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: AppSpacing.s3),
                  DeviceStatusCard(link: link),
                  const SizedBox(height: AppSpacing.s6),
                ],
                Text('배정 차량', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: AppSpacing.s3),
                if (loading)
                  const _VehicleSkeleton()
                else if (snapshot.hasError)
                  _Panel(
                    child: StatusMessage(
                      icon: Icons.error_outline,
                      iconColor: AppColors.critical,
                      title: homeLoadFailedMessage,
                      message: '네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
                      actions: [FilledButton(onPressed: _reload, child: const Text('다시 시도'))],
                    ),
                  )
                else if (data?.assignedVehicle case final vehicle?)
                  _VehicleCard(vehicle: vehicle)
                else
                  _Panel(
                    child: StatusMessage(
                      icon: Icons.directions_car_outlined,
                      title: noVehicleMessage,
                      actions: [OutlinedButton(onPressed: _reload, child: const Text('새로고침'))],
                    ),
                  ),
                if (AppScope.of(context).sensorMode != null) ...[
                  const SizedBox(height: AppSpacing.s6),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: () => context.push('/settings/sensor'),
                      icon: const Icon(Icons.tune),
                      label: const Text('센서 설정(개발용)'),
                    ),
                  ),
                ],
              ],
            ),
          ),
        );
      },
    );
  }

  /// BLE·가상 단말 모드일 때만 단말 상태를 보여 준다
  DeviceLinkController? _deviceLink(BuildContext context) {
    final scope = AppScope.of(context);
    final mode = scope.sensorMode;
    if (scope.deviceLink == null || mode == null || mode.mode == SensorMode.mock) return null;
    return scope.deviceLink;
  }

  Future<void> _confirmSignOut(BuildContext context) async {
    final session = AppScope.of(context).session;
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('로그아웃할까요?'),
        content: const Text('다시 사용하려면 이메일과 비밀번호로 로그인해야 합니다.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('취소')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('로그아웃')),
        ],
      ),
    );
    if (ok == true) await session.signOut();
  }
}

class _DriverTitle extends StatelessWidget {
  const _DriverTitle({required this.data});
  final DriverHomeData data;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text('${data.driverName}님', style: text.titleMedium, overflow: TextOverflow.ellipsis),
        const SizedBox(height: 2),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s2, vertical: 2),
          decoration: BoxDecoration(
            color: AppColors.bgPanel,
            borderRadius: BorderRadius.circular(AppRadius.md),
            border: Border.all(color: AppColors.border),
          ),
          child: Text(
            data.orgName,
            style: text.bodySmall?.copyWith(color: AppColors.textMain),
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(padding: const EdgeInsets.all(AppSpacing.s6), child: child),
  );
}

class _VehicleCard extends StatelessWidget {
  const _VehicleCard({required this.vehicle});
  final VehicleSummary vehicle;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.s4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(
              label: '차량 번호 ${vehicle.plateNumber}',
              child: ExcludeSemantics(child: Text(vehicle.plateNumber, style: text.headlineSmall)),
            ),
            const SizedBox(height: AppSpacing.s1),
            Text(vehicle.modelLabel, style: text.bodyLarge?.copyWith(color: AppColors.textMuted)),
            const SizedBox(height: AppSpacing.s3),
            // 실제 단말 연결(BLE)은 후속 작업. 지금은 대기 상태만 보여 준다
            Chip(
              avatar: const Icon(Icons.sensors_off, size: 18, color: AppColors.textMuted),
              label: const Text('단말 연결 대기 중'),
              backgroundColor: AppColors.bgBase,
              side: const BorderSide(color: AppColors.borderStrong),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.md)),
            ),
            const SizedBox(height: AppSpacing.s3),
            FilledButton.icon(
              onPressed: () => context.go('/gauge'),
              icon: const Icon(Icons.speed),
              label: const Text('실시간 페달 게이지'),
            ),
          ],
        ),
      ),
    );
  }
}

/// 차량 카드 자리 표시(움직임 줄이기 설정이면 깜박이지 않는다)
class _VehicleSkeleton extends StatefulWidget {
  const _VehicleSkeleton();

  @override
  State<_VehicleSkeleton> createState() => _VehicleSkeletonState();
}

class _VehicleSkeletonState extends State<_VehicleSkeleton> with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 900));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.of(context).disableAnimations) {
      _pulse.value = 1;
    } else if (!_pulse.isAnimating) {
      _pulse.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    Widget block(double width, double height) => Container(
      width: width,
      height: height,
      decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(AppRadius.md)),
    );
    return Semantics(
      label: '차량 정보를 불러오는 중',
      liveRegion: true,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.s4),
          child: FadeTransition(
            opacity: Tween<double>(begin: 0.5, end: 1).animate(_pulse),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                block(160, 28),
                const SizedBox(height: AppSpacing.s2),
                block(200, 18),
                const SizedBox(height: AppSpacing.s3),
                block(140, 32),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
