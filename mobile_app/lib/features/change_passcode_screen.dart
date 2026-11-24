import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../common/widgets.dart';
import '../core/api_client.dart';
import '../core/providers.dart';
import '../core/theme.dart';

/// Lets the signed-in user choose their own passcode. Shown full-screen and unavoidable
/// on first login (the server blocks everything else until it is done); otherwise it is
/// opened from the account menu and can be cancelled.
class ChangePasscodeScreen extends ConsumerStatefulWidget {
  const ChangePasscodeScreen({super.key});

  @override
  ConsumerState<ChangePasscodeScreen> createState() => _ChangePasscodeScreenState();
}

class _ChangePasscodeScreenState extends ConsumerState<ChangePasscodeScreen> {
  final _formKey = GlobalKey<FormState>();
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false, _show = false;
  String? _error;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _save(bool forced) async {
    if (!_formKey.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      await ref.read(authControllerProvider.notifier).changePassword(_current.text, _next.text);
      if (!mounted) return;
      showSnack(context, 'Passcode changed');
      if (forced) {
        context.go('/sites');
      } else if (context.canPop()) {
        context.pop();
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Something went wrong. Please try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _field(TextEditingController c, String label, {String? Function(String?)? validator, String? hint}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: TextFormField(
        controller: c,
        obscureText: !_show,
        enableSuggestions: false,
        autocorrect: false,
        decoration: InputDecoration(labelText: label, hintText: hint, prefixIcon: const Icon(Icons.lock_outline_rounded)),
        validator: validator ?? (v) => (v == null || v.isEmpty) ? 'Required' : null,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authControllerProvider).value;
    final forced = user?.mustChangePassword ?? false;

    return PopScope(
      canPop: !forced,
      child: Scaffold(
        appBar: AppBar(
          title: Text(forced ? 'Choose your passcode' : 'Change passcode'),
          automaticallyImplyLeading: !forced,
          actions: [
            if (forced)
              TextButton(
                onPressed: _busy ? null : () => ref.read(authControllerProvider.notifier).logout(),
                child: const Text('SIGN OUT'),
              ),
          ],
        ),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              if (forced)
                const Padding(
                  padding: EdgeInsets.only(bottom: 16),
                  child: Text(
                    'You are still using the shared initial passcode. Set a personal passcode to continue.',
                    style: TextStyle(color: Brand.textMuted),
                  ),
                ),
              if (_error != null) ...[ErrorBanner(_error!), const SizedBox(height: 14)],
              Form(
                key: _formKey,
                child: Column(
                  children: [
                    _field(_current, 'Current passcode'),
                    _field(
                      _next,
                      'New passcode',
                      hint: 'At least 8 characters, letters and numbers',
                      validator: (v) {
                        if (v == null || v.isEmpty) return 'Required';
                        if (v.length < 8) return 'At least 8 characters';
                        if (!RegExp(r'[A-Za-z]').hasMatch(v) || !RegExp(r'\d').hasMatch(v)) {
                          return 'Use letters and numbers';
                        }
                        return null;
                      },
                    ),
                    _field(
                      _confirm,
                      'Confirm new passcode',
                      validator: (v) => v != _next.text ? 'Does not match the new passcode' : null,
                    ),
                  ],
                ),
              ),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                title: const Text('Show passcodes'),
                value: _show,
                onChanged: (v) => setState(() => _show = v ?? false),
              ),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: _busy ? null : () => _save(forced),
                child: _busy
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('SAVE NEW PASSCODE'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
