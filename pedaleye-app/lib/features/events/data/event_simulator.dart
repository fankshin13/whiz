import '../../../core/forensics/event_recorder.dart';

/// 실물 단말이 없을 때 쓰는 모의 사고 기록기. 단말 펌웨어와 같은 EventRecorder 로
/// 가상 주행을 즉시 흘려 60초(20Hz, 1,200개) 해시 체인 세션을 만든다. 끝 시각은 지금 무렵이다.
abstract final class EventSimulator {
  /// 주행 중 급제동 → 급가감속 트리거
  static FrozenSession suddenBrake(String deviceId, {DateTime? now}) {
    const drive = [
      DriveSegment(durationMs: 40000, accel: 0.4, brake: 0, speedKmh: 50),
      DriveSegment(durationMs: 500, accel: 0, brake: 0, speedKmh: 50),
      DriveSegment(durationMs: 40000, accel: 0, brake: 1, speedKmh: 0),
    ];
    return _record(deviceId, drive, now: now);
  }

  /// 운전자가 '긴급 백업'을 누른 순간 기준 직전 30초 + 이후 30초
  static FrozenSession manualBackup(String deviceId, {DateTime? now}) {
    const drive = [DriveSegment(durationMs: 120000, accel: 0.25, brake: 0, speedKmh: 30)];
    return _record(deviceId, drive, now: now, pressManualAt: 600);
  }

  static FrozenSession _record(String deviceId, List<DriveSegment> drive, {DateTime? now, int? pressManualAt}) {
    final total = drive.fold<int>(0, (sum, s) => sum + s.durationMs);
    final start = (now ?? DateTime.now()).millisecondsSinceEpoch - total;
    final recorder = EventRecorder(deviceId);
    var count = 0;
    for (final sample in mockPedalHardwareStream(drive, start)) {
      recorder.ingest(sample);
      count++;
      if (count == pressManualAt) recorder.pressManualButton();
      if (recorder.state == RecorderState.frozen) break;
    }
    return recorder.freeze();
  }
}
