import 'dart:io';
import 'dart:typed_data';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../../../core/forensics/event_recorder.dart';
import '../domain/event_models.dart';

class EventsLoadException implements Exception {
  const EventsLoadException();
}

abstract interface class DriverEventsRepository {
  /// 서버에 저장된 본인 사고 세션(최신순)
  Future<List<ServerEventSession>> listMySessions();

  /// 한 건. 볼 수 없거나 없으면 null
  Future<ServerEventSession?> getSession(String id);

  /// 세션 원본(.pel). 차트·지문 표시용
  Future<Uint8List> downloadLog(ServerEventSession session);
}

/// RLS 가 운전자를 본인 배정 차량 세션으로 제한한다. 앱은 별도 조건을 믿지 않는다.
class SupabaseDriverEventsRepository implements DriverEventsRepository {
  SupabaseDriverEventsRepository(this._client);
  final SupabaseClient _client;

  static const _columns =
      'id, device_id, trigger_type, start_time, end_time, record_count, initial_chain_hash, final_chain_hash, '
      'integrity_verified, raw_log_storage_path, device:devices!inner(vehicle:vehicles!inner(plate_number))';

  @override
  Future<List<ServerEventSession>> listMySessions() => _guard(() async {
    final rows = await _client.from('event_sessions').select(_columns).order('start_time', ascending: false).limit(100);
    return rows.map(parse).nonNulls.toList();
  });

  @override
  Future<ServerEventSession?> getSession(String id) => _guard(() async {
    if (!RegExp(r'^[0-9a-fA-F-]{36}$').hasMatch(id)) return null;
    final row = await _client.from('event_sessions').select(_columns).eq('id', id).maybeSingle();
    return row == null ? null : parse(row);
  });

  Future<T> _guard<T>(Future<T> Function() run) async {
    try {
      return await run();
    } on PostgrestException {
      throw const EventsLoadException();
    } on SocketException {
      throw const EventsLoadException();
    } on AuthException {
      throw const EventsLoadException();
    }
  }

  static ServerEventSession? parse(Map<String, dynamic> row) {
    final device = row['device'];
    final vehicle = device is Map<String, dynamic> ? device['vehicle'] : null;
    final plate = vehicle is Map<String, dynamic> ? vehicle['plate_number'] : null;
    final trigger = TriggerType.fromDb(row['trigger_type']);
    final start = DateTime.tryParse('${row['start_time']}');
    final end = DateTime.tryParse('${row['end_time']}');
    final id = row['id'];
    final deviceId = row['device_id'];
    final count = row['record_count'];
    final verified = row['integrity_verified'];
    if (id is! String || deviceId is! String || trigger == null || start == null || end == null) return null;
    if (count is! int || verified is! bool || plate is! String) return null;
    String? str(Object? v) => v is String ? v : null;
    return ServerEventSession(
      id: id,
      deviceId: deviceId,
      triggerType: trigger,
      startTime: start,
      endTime: end,
      recordCount: count,
      integrityVerified: verified,
      plateNumber: plate,
      initialHash: str(row['initial_chain_hash']),
      finalHash: str(row['final_chain_hash']),
      rawLogPath: str(row['raw_log_storage_path']),
    );
  }

  @override
  Future<Uint8List> downloadLog(ServerEventSession session) async {
    final path = session.rawLogPath;
    if (path == null) throw const EventsLoadException();
    try {
      return await _client.storage.from('event-logs').download(path);
    } on StorageException {
      throw const EventsLoadException();
    } on SocketException {
      throw const EventsLoadException();
    }
  }
}
