import 'dart:io';

import 'package:supabase_flutter/supabase_flutter.dart';

import '../domain/driver_home_data.dart';

class HomeLoadException implements Exception {
  const HomeLoadException();
}

abstract interface class DriverHomeRepository {
  Future<DriverHomeData> load(String userId);
}

/// RLS 로 본인 프로필·소속 조직·배정 차량만 보인다. 앱은 다른 조건을 믿지 않는다.
class SupabaseDriverHomeRepository implements DriverHomeRepository {
  SupabaseDriverHomeRepository(this._client);
  final SupabaseClient _client;

  @override
  Future<DriverHomeData> load(String userId) async {
    try {
      final profile = await _client.from('users').select('name, organizations(name)').eq('id', userId).single();
      final vehicle = await _client
          .from('vehicles')
          .select('id, plate_number, model_name, model_year')
          .eq('assigned_user_id', userId)
          .order('plate_number')
          .limit(1)
          .maybeSingle();
      return parse(userId: userId, profile: profile, vehicle: vehicle);
    } on PostgrestException {
      throw const HomeLoadException();
    } on SocketException {
      throw const HomeLoadException();
    } on AuthException {
      throw const HomeLoadException();
    }
  }

  static DriverHomeData parse({
    required String userId,
    required Map<String, dynamic> profile,
    required Map<String, dynamic>? vehicle,
  }) {
    final name = profile['name'];
    final org = profile['organizations'];
    final orgName = org is Map<String, dynamic> ? org['name'] : null;
    return DriverHomeData(
      userId: userId,
      driverName: name is String && name.isNotEmpty ? name : '운전자',
      orgName: orgName is String ? orgName : '소속 없음',
      assignedVehicle: vehicle == null ? null : _vehicle(vehicle),
    );
  }

  static VehicleSummary _vehicle(Map<String, dynamic> row) {
    final id = row['id'];
    final plate = row['plate_number'];
    final model = row['model_name'];
    final year = row['model_year'];
    if (id is! String || plate is! String || model is! String) throw const HomeLoadException();
    return VehicleSummary(vehicleId: id, plateNumber: plate, modelName: model, modelYear: year is int ? year : null);
  }
}
