import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/providers.dart';
import '../core/theme.dart';

/// Shown to CLIENT accounts: they view incidents and inspections for their own sites on the
/// web portal, so the field app has nothing for them (SRS FR-20).
class ClientNoticeScreen extends ConsumerWidget {
  const ClientNoticeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).value;
    // No app bar here, so the status bar sits on the light page: it needs dark icons.
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark,
      child: Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.desktop_windows_rounded, size: 56, color: Brand.gold),
                const SizedBox(height: 20),
                Text(
                  user == null ? 'Client account' : 'Welcome, ${user.name}',
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 12),
                const Text(
                  'Client accounts view incidents and site inspections on the ISOMS web portal. This field app is for AB Securitas staff.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Brand.textMuted, height: 1.4),
                ),
                const SizedBox(height: 28),
                OutlinedButton.icon(
                  onPressed: () => ref.read(authControllerProvider.notifier).logout(),
                  icon: const Icon(Icons.logout_rounded),
                  label: const Text('SIGN OUT'),
                ),
              ],
            ),
          ),
        ),
      ),
      ),
    );
  }
}
