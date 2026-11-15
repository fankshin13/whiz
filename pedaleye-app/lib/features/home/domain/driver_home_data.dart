class DriverHomeData {
  const DriverHomeData({required this.userId, required this.driverName, required this.orgName, this.assignedVehicle});

  final String userId;
  final String driverName;
  final String orgName;
  final VehicleSummary? assignedVehicle;
}

class VehicleSummary {
  const VehicleSummary({required this.vehicleId, required this.plateNumber, required this.modelName, this.modelYear});

  final String vehicleId;
  final String plateNumber;
  final String modelName;
  final int? modelYear;

  /// 예: "아이오닉 5 (2024년형)"
  String get modelLabel => modelYear == null ? modelName : '$modelName ($modelYear년형)';
}
