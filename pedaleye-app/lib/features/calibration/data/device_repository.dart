import 'dart:async';
import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../../../core/calibration/calibration_wizard_state_machine.dart';
import '../../../core/telemetry/displacement_engine.dart';
import '../../../core/telemetry/telemetry_controller.dart';
import '../domain/driver_device.dart';

class DeviceLoadException implements Exception {
  const DeviceLoadException();
}

enum CalibrationSaveFailure { invalidStroke, forbidden, network }

class CalibrationSaveException implements Exception {
  const CalibrationSaveException(this.failure);
  final CalibrationSaveFailure failure;
}

abstract interface class DeviceRepository {
  /// 본인 배정 차량의 단말. 없으면 null.
  Future<DriverDevice?> loadMyDevice(String userId);

  /// 보정값 4개 저장. 권한·가동 범위는 DB(RLS·트리거·CHECK)가 다시 막는다.
  Future<void> saveCalibration(CalibrationPayload payload);
}

class SupabaseDeviceRepository implements DeviceRepository {
  SupabaseDeviceRepository(this._client);
  final SupabaseClient _client;

  @override
  Future<DriverDevice?> loadMyDevice(String userId) async {
    try {
      final row = await _client
          .from('devices')
          .select(
            'id, serial_number, accel_calib_min, accel_calib_max, brake_calib_min, brake_calib_max, '
            'vehicle:vehicles!inner(plate_number, assigned_user_id)',
          )
          .eq('vehicle.assigned_user_id', userId)
          .order('serial_number')
          .limit(1)
          .maybeSingle();
      return row == null ? null : parse(row);
    } on PostgrestException {
      throw const DeviceLoadException();
    } on SocketException {
      throw const DeviceLoadException();
    } on AuthException {
      throw const DeviceLoadException();
    }
  }

  static DriverDevice parse(Map<String, dynamic> row) {
    final vehicle = row['vehicle'];
    final values = [row['accel_calib_min'], row['accel_calib_max'], row['brake_calib_min'], row['brake_calib_max']];
    final id = row['id'];
    final serial = row['serial_number'];
    final plate = vehicle is Map<String, dynamic> ? vehicle['plate_number'] : null;
    if (id is! String || serial is! String || plate is! String || values.any((v) => v is! int)) {
      throw const DeviceLoadException();
    }
    final [accelMin, accelMax, brakeMin, brakeMax] = values.cast<int>();
    return DriverDevice(
      deviceId: id,
      serialNumber: serial,
      plateNumber: plate,
      calibration: PedalCalibration(
        accelCalibMin: accelMin,
        accelCalibMax: accelMax,
        brakeCalibMin: brakeMin,
        brakeCalibMax: brakeMax,
      ),
    );
  }

  @override
  Future<void> saveCalibration(CalibrationPayload payload) async {
    // 클라이언트 1차 확인(DB CHECK 제약이 최종 판정)
    if (!isValidStroke(payload.accelCalibMin, payload.accelCalibMax) ||
        !isValidStroke(payload.brakeCalibMin, payload.brakeCalibMax)) {
      throw const CalibrationSaveException(CalibrationSaveFailure.invalidStroke);
    }
    try {
      final updated = await _client
          .from('devices')
          .update({
            'accel_calib_min': payload.accelCalibMin,
            'accel_calib_max': payload.accelCalibMax,
            'brake_calib_min': payload.brakeCalibMin,
            'brake_calib_max': payload.brakeCalibMax,
          })
          .eq('id', payload.deviceId)
          .select('id');
      // RLS 에 걸리면 오류 없이 0행이 바뀐다
      if (updated.isEmpty) throw const CalibrationSaveException(CalibrationSaveFailure.forbidden);
    } on PostgrestException catch (error) {
      throw CalibrationSaveException(switch (error.code) {
        '42501' => CalibrationSaveFailure.forbidden,
        '23514' => CalibrationSaveFailure.invalidStroke,
        _ => CalibrationSaveFailure.network,
      });
    } on SocketException {
      throw const CalibrationSaveException(CalibrationSaveFailure.network);
    } on TimeoutException {
      throw const CalibrationSaveException(CalibrationSaveFailure.network);
    } on AuthException {
      throw const CalibrationSaveException(CalibrationSaveFailure.network);
    }
  }
}
