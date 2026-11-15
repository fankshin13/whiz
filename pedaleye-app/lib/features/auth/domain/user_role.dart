/// public.users.role (DB enum user_role) 과 같은 값
enum UserRole {
  driver,
  orgAdmin,
  superAdmin,
  investigator;

  static UserRole? fromDb(Object? value) => switch (value) {
    'driver' => UserRole.driver,
    'org_admin' => UserRole.orgAdmin,
    'super_admin' => UserRole.superAdmin,
    'investigator' => UserRole.investigator,
    _ => null,
  };

  /// 모바일 앱은 운전자 전용이다
  bool get canUseApp => this == UserRole.driver;
}
