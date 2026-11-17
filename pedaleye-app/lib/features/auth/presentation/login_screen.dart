import 'package:material_ui/material_ui.dart';
import 'package:go_router/go_router.dart';

import '../../../app_scope.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/brand_mark.dart';
import '../../../core/widgets/busy_button.dart';
import '../../../core/widgets/form_error.dart';
import '../../../core/widgets/screen_body.dart';
import '../data/auth_repository.dart';

const invalidCredentialsMessage = '이메일 또는 비밀번호가 올바르지 않습니다.';
const networkErrorMessage = '서버와 통신할 수 없습니다. 네트워크 연결을 확인해 주세요.';
const deactivatedMessage = '계정이 비활성화되었습니다. 관리자에게 문의하세요.';
const unknownSignInMessage = '일시적인 오류로 로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;
  bool _checkedDeactivated = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // 남아 있던 세션이 비활성 계정이라 로그아웃된 경우 한 번 안내한다
    if (!_checkedDeactivated) {
      _checkedDeactivated = true;
      if (AppScope.of(context).session.takeAccountDeactivated()) _error = deactivatedMessage;
    }
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy || !(_formKey.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      // 성공하면 세션 상태가 바뀌고 라우터가 역할 확인 후 화면을 옮긴다
      await AppScope.of(context).auth.signIn(email: _email.text, password: _password.text);
    } on SignInException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = switch (error.failure) {
          SignInFailure.invalidCredentials => invalidCredentialsMessage,
          SignInFailure.deactivated => deactivatedMessage,
          SignInFailure.network => networkErrorMessage,
          SignInFailure.unknown => unknownSignInMessage,
        };
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Scaffold(
      body: ScreenBody(
        center: true,
        children: [
          const BrandMark(),
          const SizedBox(height: AppSpacing.s2),
          Text(
            '운전자 전용 앱',
            style: text.bodyLarge?.copyWith(color: AppColors.textMuted),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: AppSpacing.s8),
          Form(
            key: _formKey,
            child: AutofillGroup(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextFormField(
                    controller: _email,
                    enabled: !_busy,
                    keyboardType: TextInputType.emailAddress,
                    textInputAction: TextInputAction.next,
                    autofillHints: const [AutofillHints.email],
                    autocorrect: false,
                    decoration: const InputDecoration(labelText: '이메일'),
                    validator: (v) => (v == null || !v.contains('@')) ? '이메일 형식을 확인해 주세요.' : null,
                  ),
                  const SizedBox(height: AppSpacing.s4),
                  TextFormField(
                    controller: _password,
                    enabled: !_busy,
                    obscureText: true,
                    textInputAction: TextInputAction.done,
                    autofillHints: const [AutofillHints.password],
                    decoration: const InputDecoration(labelText: '비밀번호'),
                    validator: (v) => (v == null || v.isEmpty) ? '비밀번호를 입력해 주세요.' : null,
                    onFieldSubmitted: (_) => _submit(),
                  ),
                  const SizedBox(height: AppSpacing.s4),
                  if (_error != null) ...[FormError(_error!), const SizedBox(height: AppSpacing.s4)],
                  BusyButton(label: '로그인', busyLabel: '로그인 중', busy: _busy, onPressed: _submit),
                ],
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.s6),
          Wrap(
            alignment: WrapAlignment.center,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text('초대 링크 또는 코드가 있으신가요?', style: text.bodyMedium?.copyWith(color: AppColors.textMuted)),
              TextButton(onPressed: _busy ? null : () => context.go('/invite'), child: const Text('초대 수락')),
            ],
          ),
        ],
      ),
    );
  }
}
