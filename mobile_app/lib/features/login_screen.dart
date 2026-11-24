import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../common/widgets.dart';
import '../core/providers.dart';
import '../core/theme.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _epf = TextEditingController();
  final _password = TextEditingController();
  bool _obscure = true;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _epf.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      await ref.read(authControllerProvider.notifier).login(_epf.text.trim(), _password.text);
      // The router redirects to /sites once auth state changes.
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        // Uniform green page with a register-paper card, like the web sign-in.
        decoration: const BoxDecoration(color: Brand.sidebar),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Container(
                  padding: const EdgeInsets.all(24),
                  decoration: const BoxDecoration(
                    color: Brand.bg,
                    borderRadius: BorderRadius.all(Radius.circular(8)),
                    border: Border(top: BorderSide(color: Brand.brass, width: 6)),
                  ),
                  child: Form(
                  key: _formKey,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Center(
                        child: Image.asset(
                          'assets/images/ab-securitas-logo.png',
                          height: 52,
                          semanticLabel: 'AB Securitas (Pvt) Ltd',
                        ),
                      ),
                      const SizedBox(height: 20),
                      const Text(
                        'AB SECURITAS',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontFamily: Brand.fontDisplay, fontSize: 34, fontWeight: FontWeight.w800, letterSpacing: 1.2),
                      ),
                      const SizedBox(height: 4),
                      const Text(
                        'ISOMS Field Operations',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Brand.textMuted, letterSpacing: 0.5),
                      ),
                      const SizedBox(height: 36),
                      TextFormField(
                        controller: _epf,
                        enabled: !_busy,
                        textInputAction: TextInputAction.next,
                        autocorrect: false,
                        enableSuggestions: false,
                        textCapitalization: TextCapitalization.characters,
                        autofillHints: const [AutofillHints.username],
                        inputFormatters: [FilteringTextInputFormatter.deny(RegExp(r'\s'))],
                        decoration: const InputDecoration(
                          labelText: 'EPF Staff ID',
                          prefixIcon: Icon(Icons.badge_outlined),
                        ),
                        validator: requiredField,
                      ),
                      const SizedBox(height: 14),
                      TextFormField(
                        controller: _password,
                        enabled: !_busy,
                        obscureText: _obscure,
                        autocorrect: false,
                        enableSuggestions: false,
                        autofillHints: const [AutofillHints.password],
                        textInputAction: TextInputAction.done,
                        onFieldSubmitted: (_) => _submit(),
                        decoration: InputDecoration(
                          labelText: 'Passcode',
                          prefixIcon: const Icon(Icons.lock_outline_rounded),
                          suffixIcon: IconButton(
                            tooltip: _obscure ? 'Show passcode' : 'Hide passcode',
                            icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                            onPressed: () => setState(() => _obscure = !_obscure),
                          ),
                        ),
                        validator: requiredField,
                      ),
                      if (_error != null) ...[const SizedBox(height: 16), ErrorBanner(_error!)],
                      const SizedBox(height: 24),
                      FilledButton(
                        onPressed: _busy ? null : _submit,
                        child: _busy
                            ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
                            : const Text('SIGN IN'),
                      ),
                      const SizedBox(height: 24),
                      const Text(
                        'Authorised AB Securitas personnel only.\nActivity is logged and audited.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Brand.textDim, fontSize: 11, height: 1.5),
                      ),
                    ],
                  ),
                ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
