/// 한국 표준시(UTC+9, 일광절약시간 없음)로 'YYYY.MM.DD HH:mm:ss'
String formatKst(DateTime time) {
  final k = time.toUtc().add(const Duration(hours: 9));
  String two(int v) => v.toString().padLeft(2, '0');
  return '${k.year}.${two(k.month)}.${two(k.day)} ${two(k.hour)}:${two(k.minute)}:${two(k.second)}';
}

/// 긴 해시 지문을 앞·뒤 8자리만 보이게
String shortHash(String? hex) {
  if (hex == null || hex.isEmpty) return '-';
  return hex.length <= 20 ? hex : '${hex.substring(0, 8)}…${hex.substring(hex.length - 8)}';
}

/// 1200 → '1,200'
String formatCount(int value) => value.toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
