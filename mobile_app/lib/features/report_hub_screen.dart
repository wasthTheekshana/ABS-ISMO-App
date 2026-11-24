import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/offline_queue.dart';
import '../core/providers.dart';
import '../core/theme.dart';

/// Entry point for everything a field officer can report.
class ReportHubScreen extends ConsumerWidget {
  const ReportHubScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    const items = <(String, String, IconData, Color, String)>[
      ('Guard absence', 'Log a guard who did not report for duty', Icons.person_off_rounded, Brand.danger, '/report/absence'),
      ('Late reporting', 'Log a guard who arrived late for their shift', Icons.schedule_rounded, Brand.gold, '/report/late'),
      ('Incident', 'Security, safety, medical or operational incident', Icons.shield_rounded, Brand.danger, '/report/incident'),
      ('Site inspection', 'Digital site-visit checklist and rating', Icons.fact_check_rounded, Brand.primary, '/report/inspection'),
    ];

    final pending = ref.watch(pendingReportsProvider);
    // Each report type is limited to the roles the server accepts it from (SRS FR-4/5/15/20).
    final user = ref.watch(authControllerProvider).value;
    bool allowed(String route) => switch (route) {
          '/report/absence' || '/report/late' => user?.canLogAttendance ?? false,
          '/report/inspection' => user?.canInspect ?? false,
          '/report/incident' => user?.canReportIncident ?? false,
          _ => false,
        };
    final visible = [
      for (final item in items)
        if (allowed(item.$5)) item,
    ];

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (pending.queued.isNotEmpty) ...[
          _PendingBanner(count: pending.queued.length, syncing: pending.syncing),
          const SizedBox(height: 12),
        ],
        for (final report in pending.rejected) ...[
          _RejectedBanner(report: report),
          const SizedBox(height: 12),
        ],
        for (final item in visible) ...[
          _HubCard(title: item.$1, subtitle: item.$2, icon: item.$3, color: item.$4, route: item.$5),
          const SizedBox(height: 12),
        ],
      ],
    );
  }
}

class _HubCard extends StatelessWidget {
  const _HubCard({required this.title, required this.subtitle, required this.icon, required this.color, required this.route});

  final String title, subtitle, route;
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push(route),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: color.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(14)),
                child: Icon(icon, color: color, size: 26),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 2),
                    Text(subtitle, style: const TextStyle(color: Brand.textMuted, fontSize: 12)),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right_rounded, color: Brand.textDim),
            ],
          ),
        ),
      ),
    );
  }
}

/// Reports saved on the phone that have not reached the server yet.
class _PendingBanner extends ConsumerWidget {
  const _PendingBanner({required this.count, required this.syncing});

  final int count;
  final bool syncing;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Card(
      color: Brand.gold.withValues(alpha: 0.12),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
        child: Row(
          children: [
            syncing
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.cloud_off_rounded, color: Brand.gold),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                '$count ${count == 1 ? 'report is' : 'reports are'} waiting to be sent. They send automatically when you are online.',
                style: const TextStyle(fontSize: 12.5),
              ),
            ),
            TextButton(
              onPressed: syncing ? null : () => ref.read(pendingReportsProvider.notifier).flush(),
              child: const Text('SEND NOW'),
            ),
          ],
        ),
      ),
    );
  }
}

/// A queued report the server refused. It will not be retried, so the officer must see it.
class _RejectedBanner extends ConsumerWidget {
  const _RejectedBanner({required this.report});

  final PendingReport report;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Card(
      color: Brand.danger.withValues(alpha: 0.12),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
        child: Row(
          children: [
            const Icon(Icons.error_outline_rounded, color: Brand.danger),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                'A saved ${report.label.toLowerCase()} was rejected by the server and was NOT recorded: ${report.rejection}. Please file it again.',
                style: const TextStyle(fontSize: 12.5),
              ),
            ),
            TextButton(
              onPressed: () => ref.read(pendingReportsProvider.notifier).dismissRejected(report),
              child: const Text('DISMISS'),
            ),
          ],
        ),
      ),
    );
  }
}
