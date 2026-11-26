import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../common/widgets.dart';
import '../core/theme.dart';

/// Shown only after the SERVER has stored a record; [recordId] is the ID the server issued.
class ConfirmationScreen extends StatelessWidget {
  const ConfirmationScreen({super.key, required this.recordId, required this.label, this.queued = false});

  final String recordId, label;

  /// True when the report is saved on the phone and will be sent once the server is reachable.
  final bool queued;

  @override
  Widget build(BuildContext context) {
    // No app bar here, so the status bar sits on the light page: it needs dark icons.
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark,
      child: Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 96,
                  height: 96,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: (queued ? Brand.gold : Brand.success).withValues(alpha: 0.15),
                  ),
                  child: Icon(queued ? Icons.cloud_off_rounded : Icons.check_rounded,
                      size: 56, color: queued ? Brand.gold : Brand.success),
                ),
              ),
              const SizedBox(height: 24),
              Text(queued ? '$label saved on this phone' : '$label recorded',
                  textAlign: TextAlign.center, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
              const SizedBox(height: 8),
              Text(
                queued
                    ? 'No connection to the ISOMS server. It will be sent automatically as soon as you are back online. Keep the app installed until it has synced.'
                    : 'Saved to the ISOMS audit log.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Brand.textMuted),
              ),
              const SizedBox(height: 24),
              if (!queued)
                Card(
                  child: ListTile(
                    title: const Text('Reference ID', style: TextStyle(color: Brand.textMuted, fontSize: 12)),
                    subtitle: SelectableText(recordId, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                    trailing: IconButton(
                      tooltip: 'Copy',
                      icon: const Icon(Icons.copy_rounded, size: 20),
                      onPressed: () {
                        Clipboard.setData(ClipboardData(text: recordId));
                        showSnack(context, 'Reference ID copied');
                      },
                    ),
                  ),
                ),
              const SizedBox(height: 32),
              FilledButton(onPressed: () => context.go('/sites'), child: const Text('DONE')),
              const SizedBox(height: 10),
              OutlinedButton(onPressed: () => context.go('/activity'), child: const Text('VIEW ACTIVITY LOG')),
            ],
          ),
        ),
      ),
      ),
    );
  }
}
