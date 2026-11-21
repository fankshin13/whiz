import 'package:material_ui/material_ui.dart';

import '../../../app_scope.dart';
import '../../../core/text/keep_all.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/busy_button.dart';
import '../../../core/widgets/form_error.dart';
import '../../../core/widgets/screen_body.dart';
import '../data/auth_repository.dart';

const accountDeletionConfirmPhrase = '계정 삭제';

/// 본인 계정 삭제 요청(Play 정책). 비밀번호와 확인 문구를 받아 즉시 비활성화하고 로그아웃한다.
/// 계정 정보는 비활성화 후 1년, 사고 기록은 생성 후 3년 보관한 뒤 파기한다(개인정보처리방침).
class AccountDeletionScreen extends StatefulWidget {
  const AccountDeletionScreen({super.key});

  @override
  State<AccountDeletionScreen> createState() => _AccountDeletionScreenState();
}

class _AccountDeletionScreenState extends State<AccountDeletionScreen> {
  final _formKey = GlobalKey<FormState>();
  final _password = TextEditingController();
  final _reason = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _password.dispose();
    _reason.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy || !(_formKey.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      // 성공하면 로그아웃되고 라우터가 로그인 화면으로 보낸다(로그인 화면이 접수 안내)
      await AppScope.of(context).session.requestAccountDeletion(password: _password.text, reason: _reason.text);
    } on AccountDeletionException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = switch (error.failure) {
          AccountDeletionFailure.wrongPassword => '비밀번호가 올바르지 않습니다.',
          AccountDeletionFailure.alreadyInactive => '이미 비활성화된 계정입니다.',
          AccountDeletionFailure.notAllowed => '이 계정은 앱에서 삭제를 요청할 수 없습니다. 관리자에게 문의하세요.',
          AccountDeletionFailure.network => '인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
          AccountDeletionFailure.unknown => '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        };
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('계정 삭제 요청')),
      body: ScreenBody(
        children: [
          Text(keepAll('요청하면 계정이 즉시 비활성화되어 다시 로그인할 수 없고, 배정 차량에서 해제됩니다.'), style: text.bodyLarge),
          const SizedBox(height: AppSpacing.s3),
          Text(
            keepAll('계정 정보는 비활성화 후 1년, 사고 기록은 생성 후 3년 보관한 뒤 파기합니다. 사고 분쟁의 증거 보전을 위해서입니다.'),
            style: text.bodyMedium?.copyWith(color: AppColors.textMuted),
          ),
          const SizedBox(height: AppSpacing.s6),
          Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextFormField(
                  controller: _password,
                  enabled: !_busy,
                  obscureText: true,
                  autofillHints: const [AutofillHints.password],
                  decoration: const InputDecoration(labelText: '비밀번호(본인 확인)'),
                  validator: (v) => (v == null || v.isEmpty) ? '비밀번호를 입력해 주세요.' : null,
                ),
                const SizedBox(height: AppSpacing.s4),
                TextFormField(
                  controller: _reason,
                  enabled: !_busy,
                  maxLength: 150,
                  decoration: const InputDecoration(labelText: '사유(선택)'),
                ),
                const SizedBox(height: AppSpacing.s2),
                TextFormField(
                  controller: _confirm,
                  enabled: !_busy,
                  autocorrect: false,
                  decoration: const InputDecoration(labelText: '확인 문구 입력', helperText: '"$accountDeletionConfirmPhrase"라고 입력해 주세요'),
                  validator: (v) => v?.trim() == accountDeletionConfirmPhrase ? null : '"$accountDeletionConfirmPhrase"를 정확히 입력해 주세요.',
                ),
                const SizedBox(height: AppSpacing.s4),
                if (_error != null) ...[FormError(_error!), const SizedBox(height: AppSpacing.s4)],
                BusyButton(label: '계정 삭제 요청', busyLabel: '요청 처리 중', busy: _busy, onPressed: _submit),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
