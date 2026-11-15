import 'package:material_ui/material_ui.dart';
import 'package:go_router/go_router.dart';

import '../../../app_scope.dart';
import '../../../core/text/keep_all.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/busy_button.dart';
import '../../../core/widgets/form_error.dart';
import '../../../core/widgets/screen_body.dart';
import '../../../core/widgets/status_message.dart';
import '../data/auth_repository.dart';
import '../domain/invitation.dart';
import '../domain/invite_token.dart';

const unusableInviteMessage = '만료되었거나 이미 사용된 초대 링크입니다. 관리자에게 재발급을 요청해 주세요.';
const passwordMismatchMessage = '비밀번호가 일치하지 않습니다.';
const inviteNetworkMessage = '서버와 통신할 수 없습니다. 네트워크 연결을 확인해 주세요.';
const rateLimitedMessage = '요청이 너무 많습니다. 1분 뒤 다시 시도해 주세요.';

/// 1회용 초대 수락: 토큰 확인 → 비밀번호 설정 → 계정 생성(웹 서버) → 자동 로그인
class InviteScreen extends StatefulWidget {
  const InviteScreen({super.key, this.initialToken});

  /// 딥링크(pedaleye://invite?token=…)로 들어오면 채워진다
  final String? initialToken;

  @override
  State<InviteScreen> createState() => _InviteScreenState();
}

enum _Step { enterCode, verifying, unusable, verifyFailed, setPassword, signInFailed }

class _InviteScreenState extends State<InviteScreen> {
  final _codeForm = GlobalKey<FormState>();
  final _passwordForm = GlobalKey<FormState>();
  final _confirmField = GlobalKey<FormFieldState<String>>();
  final _code = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();

  _Step _step = _Step.enterCode;
  String? _token;
  ValidInvitation? _invitation;
  String? _verifyError;
  String? _submitError;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    final initial = widget.initialToken == null ? null : InviteToken.parse(widget.initialToken!);
    if (initial != null) {
      // 첫 프레임 뒤에 확인을 시작한다(AppScope 접근이 필요)
      WidgetsBinding.instance.addPostFrameCallback((_) => _verify(initial));
    } else if (widget.initialToken != null) {
      _step = _Step.unusable;
    }
    _password.addListener(_revalidateConfirm);
  }

  @override
  void dispose() {
    _code.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  // 새 비밀번호를 고치면 확인란의 일치 여부도 다시 알려 준다(확인란 자체는 입력할 때마다 검사)
  void _revalidateConfirm() {
    if (_confirm.text.isNotEmpty) _confirmField.currentState?.validate();
  }

  Future<void> _verify(String token) async {
    setState(() {
      _token = token;
      _step = _Step.verifying;
      _verifyError = null;
    });
    try {
      final result = await AppScope.of(context).invites.verify(token);
      if (!mounted) return;
      setState(() {
        switch (result) {
          case ValidInvitation():
            _invitation = result;
            _step = _Step.setPassword;
          case UnusableInvitation():
            _step = _Step.unusable;
        }
      });
    } on InviteRateLimitedException {
      if (mounted) setState(() => _failVerify(rateLimitedMessage));
    } on InviteNetworkException {
      if (mounted) setState(() => _failVerify(inviteNetworkMessage));
    }
  }

  void _failVerify(String message) {
    _step = _Step.verifyFailed;
    _verifyError = message;
  }

  void _submitCode() {
    if (!(_codeForm.currentState?.validate() ?? false)) return;
    final token = InviteToken.parse(_code.text);
    if (token != null) _verify(token);
  }

  Future<void> _accept() async {
    final token = _token;
    if (_submitting || token == null || !(_passwordForm.currentState?.validate() ?? false)) return;
    setState(() {
      _submitting = true;
      _submitError = null;
    });
    final scope = AppScope.of(context);
    try {
      final email = await scope.invites.accept(token: token, password: _password.text);
      try {
        // 성공하면 세션 상태가 바뀌어 라우터가 홈으로 옮긴다
        await scope.auth.signIn(email: email, password: _password.text);
      } on SignInException {
        if (mounted) {
          setState(() {
            _step = _Step.signInFailed;
            _submitting = false;
          });
        }
      }
    } on AcceptInviteException catch (error) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        if (error.failure.invitationUnusable) {
          _step = _Step.unusable;
        } else {
          _submitError = switch (error.failure) {
            AcceptFailure.emailExists => '이미 가입된 이메일입니다. 로그인 화면에서 기존 비밀번호로 로그인해 주세요.',
            AcceptFailure.vehicleUnavailable => '배정 예정 차량에 이미 다른 운전자가 배정되었습니다. 관리자에게 문의해 주세요.',
            AcceptFailure.invalidInput => error.serverMessage ?? '입력값을 확인해 주세요.',
            AcceptFailure.rateLimited => rateLimitedMessage,
            _ => '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
          };
        }
      });
    } on InviteNetworkException {
      if (mounted) {
        setState(() {
          _submitting = false;
          _submitError = inviteNetworkMessage;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: !_submitting,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('초대 수락'),
          leading: IconButton(
            tooltip: '로그인 화면으로',
            icon: const Icon(Icons.arrow_back),
            onPressed: _submitting ? null : () => context.go('/login'),
          ),
        ),
        body: ScreenBody(center: _step != _Step.setPassword && _step != _Step.enterCode, children: _content(context)),
      ),
    );
  }

  List<Widget> _content(BuildContext context) {
    final toLogin = OutlinedButton(onPressed: () => context.go('/login'), child: const Text('로그인 화면으로 이동'));
    return switch (_step) {
      _Step.enterCode => _codeEntry(context),
      _Step.verifying => [
        Semantics(
          liveRegion: true,
          label: '초대 정보를 확인하고 있습니다',
          child: const Column(
            children: [
              CircularProgressIndicator(),
              SizedBox(height: AppSpacing.s4),
              ExcludeSemantics(child: Text('초대 정보를 확인하고 있습니다...')),
            ],
          ),
        ),
      ],
      _Step.unusable => [
        StatusMessage(
          icon: Icons.link_off,
          iconColor: AppColors.critical,
          title: '초대 링크를 사용할 수 없습니다',
          message: unusableInviteMessage,
          actions: [toLogin],
        ),
      ],
      _Step.verifyFailed => [
        StatusMessage(
          icon: Icons.wifi_off,
          title: '초대 정보를 확인하지 못했습니다',
          message: _verifyError,
          actions: [
            FilledButton(onPressed: () => _verify(_token!), child: const Text('다시 시도')),
            toLogin,
          ],
        ),
      ],
      _Step.signInFailed => [
        StatusMessage(
          icon: Icons.check_circle_outline,
          title: '계정 등록이 완료되었습니다',
          message: '자동 로그인에 실패했습니다. 로그인 화면에서 방금 설정한 비밀번호로 로그인해 주세요.',
          actions: [FilledButton(onPressed: () => context.go('/login'), child: const Text('로그인 화면으로 이동'))],
        ),
      ],
      _Step.setPassword => _passwordStep(context),
    };
  }

  List<Widget> _codeEntry(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return [
      Text('초대 링크 또는 코드 입력', style: text.titleMedium),
      const SizedBox(height: AppSpacing.s2),
      Text(
        keepAll('관리자에게 받은 초대 링크 전체를 붙여 넣거나, 링크 끝의 코드(64자리)를 입력해 주세요.'),
        style: text.bodyLarge?.copyWith(color: AppColors.textMuted),
      ),
      const SizedBox(height: AppSpacing.s4),
      Form(
        key: _codeForm,
        child: TextFormField(
          controller: _code,
          autocorrect: false,
          enableSuggestions: false,
          keyboardType: TextInputType.url,
          textInputAction: TextInputAction.done,
          minLines: 1,
          maxLines: 3,
          decoration: const InputDecoration(labelText: '초대 링크 또는 코드'),
          validator: (v) =>
              InviteToken.parse(v ?? '') == null ? '초대 링크 또는 코드 형식이 올바르지 않습니다. 받은 내용을 그대로 붙여 넣어 주세요.' : null,
          onFieldSubmitted: (_) => _submitCode(),
        ),
      ),
      const SizedBox(height: AppSpacing.s4),
      FilledButton(onPressed: _submitCode, child: const Text('초대 확인')),
    ];
  }

  List<Widget> _passwordStep(BuildContext context) {
    final invitation = _invitation!;
    final text = Theme.of(context).textTheme;
    return [
      Text('${invitation.inviteeName}님, 환영합니다', style: text.titleMedium),
      const SizedBox(height: AppSpacing.s2),
      Text(keepAll('비밀번호를 설정하면 배정 차량과 함께 바로 시작할 수 있습니다.'), style: text.bodyLarge?.copyWith(color: AppColors.textMuted)),
      const SizedBox(height: AppSpacing.s4),
      Card(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.s4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _InfoRow(label: '소속 조직', value: invitation.orgName),
              const SizedBox(height: AppSpacing.s3),
              _InfoRow(label: '배정 차량', value: invitation.vehiclePlate ?? '배정 예정 차량 없음'),
              const SizedBox(height: AppSpacing.s3),
              _InfoRow(label: '가입 이메일', value: invitation.email),
            ],
          ),
        ),
      ),
      const SizedBox(height: AppSpacing.s6),
      Form(
        key: _passwordForm,
        child: AutofillGroup(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextFormField(
                controller: _password,
                enabled: !_submitting,
                obscureText: true,
                autofillHints: const [AutofillHints.newPassword],
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(labelText: '새 비밀번호', helperText: '8자 이상 72자 이하'),
                validator: (v) {
                  final value = v ?? '';
                  if (value.length < 8) return '비밀번호는 8자 이상이어야 합니다.';
                  if (value.length > 72) return '비밀번호는 72자 이하로 입력해 주세요.';
                  return null;
                },
              ),
              const SizedBox(height: AppSpacing.s4),
              TextFormField(
                key: _confirmField,
                controller: _confirm,
                autovalidateMode: AutovalidateMode.onUserInteraction,
                enabled: !_submitting,
                obscureText: true,
                autofillHints: const [AutofillHints.newPassword],
                textInputAction: TextInputAction.done,
                decoration: const InputDecoration(labelText: '비밀번호 확인'),
                validator: (v) => v != _password.text ? passwordMismatchMessage : null,
                onFieldSubmitted: (_) => _accept(),
              ),
            ],
          ),
        ),
      ),
      const SizedBox(height: AppSpacing.s4),
      if (_submitError != null) ...[FormError(_submitError!), const SizedBox(height: AppSpacing.s4)],
      BusyButton(label: '가입 및 로그인 완료', busyLabel: '가입 처리 중', busy: _submitting, onPressed: _accept),
    ];
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: text.bodySmall),
        Text(value, style: text.bodyLarge?.copyWith(fontWeight: FontWeight.w600)),
      ],
    );
  }
}
