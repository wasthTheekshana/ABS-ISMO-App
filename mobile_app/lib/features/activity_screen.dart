import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../common/widgets.dart';
import '../core/models.dart';
import '../core/providers.dart';
import '../core/theme.dart';

const _tabs = <(RecordKind, String, IconData, Color)>[
  (RecordKind.absence, 'Absences', Icons.person_off_outlined, Brand.danger),
  (RecordKind.late, 'Late', Icons.schedule_rounded, Brand.gold),
  (RecordKind.incident, 'Incidents', Icons.shield_outlined, Brand.danger),
  (RecordKind.inspection, 'Inspections', Icons.fact_check_outlined, Brand.primary),
];

class ActivityScreen extends StatelessWidget {
  const ActivityScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: _tabs.length,
      child: Column(
        children: [
          TabBar(
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            indicatorColor: Brand.primary,
            labelColor: Brand.text,
            unselectedLabelColor: Brand.textMuted,
            dividerColor: Brand.border,
            tabs: [for (final t in _tabs) Tab(text: t.$2)],
          ),
          Expanded(
            child: TabBarView(children: [for (final t in _tabs) _RecordList(kind: t.$1, icon: t.$3, color: t.$4)]),
          ),
        ],
      ),
    );
  }
}

class _RecordList extends ConsumerWidget {
  const _RecordList({required this.kind, required this.icon, required this.color});

  final RecordKind kind;
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final records = ref.watch(auditLogProvider(kind));

    Future<void> refresh() async {
      ref.invalidate(auditLogProvider(kind));
      await ref.read(auditLogProvider(kind).future).catchError((_) => <AuditRecord>[]);
    }

    return RefreshIndicator(
      onRefresh: refresh,
      child: AsyncBody<List<AuditRecord>>(
        value: records,
        onRetry: refresh,
        builder: (list) {
          if (list.isEmpty) {
            return ListView(children: const [
              SizedBox(height: 80),
              EmptyState(icon: Icons.inbox_outlined, message: 'Nothing recorded here yet.'),
            ]);
          }
          return ListView.separated(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(16),
            itemCount: list.length,
            separatorBuilder: (_, _) => const SizedBox(height: 10),
            itemBuilder: (_, i) => _RecordTile(record: list[i], icon: icon, color: color),
          );
        },
      ),
    );
  }
}

class _RecordTile extends StatelessWidget {
  const _RecordTile({required this.record, required this.icon, required this.color});

  final AuditRecord record;
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(color: color.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(10)),
              child: Icon(icon, size: 20, color: color),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(record.title, style: const TextStyle(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 2),
                  Text(record.subtitle,
                      maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Brand.textMuted, fontSize: 12)),
                  const SizedBox(height: 6),
                  Text('${record.siteName} · ${formatDateTime(record.when)}',
                      style: const TextStyle(color: Brand.textDim, fontSize: 11)),
                  Text('${record.id} · ${record.submittedBy}',
                      maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Brand.textDim, fontSize: 10)),
                  if (record.badge != null && record.badge!.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    StatusBadge(record.badge!, color: color),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
