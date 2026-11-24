import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../common/widgets.dart';
import '../core/api_client.dart';
import '../core/models.dart';
import '../core/providers.dart';
import '../core/theme.dart';

/// Control Room home: the live incident queue, short-staffed sites and today's absences and
/// late reports in one scrolling view. Refreshes itself every 30 seconds.
class OpsScreen extends ConsumerStatefulWidget {
  const OpsScreen({super.key});

  @override
  ConsumerState<OpsScreen> createState() => _OpsScreenState();
}

class _OpsScreenState extends ConsumerState<OpsScreen> {
  Timer? _timer;
  String? _busyId;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => ref.invalidate(opsBoardProvider));
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _change(OpsIncident incident, String status) async {
    String? notes;
    if (status == 'Closed') {
      notes = await _askClosureNotes(context, incident.id);
      if (notes == null) return;
    }
    setState(() => _busyId = incident.id);
    try {
      await ref.read(repositoryProvider).updateIncidentStatus(incident.id, status, closureNotes: notes);
      ref.invalidate(opsBoardProvider);
      ref.invalidate(auditLogProvider);
      if (mounted) showSnack(context, status == 'Closed' ? 'Incident closed' : 'Incident escalated');
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final board = ref.watch(opsBoardProvider);
    return AsyncBody<OpsBoard>(
      value: board,
      onRetry: () => ref.invalidate(opsBoardProvider),
      builder: (b) => RefreshIndicator(
        onRefresh: () async => ref.refresh(opsBoardProvider.future),
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _Summary(board: b),
            const SizedBox(height: 20),
            _Heading('Open incidents', '${b.incidents.length}'),
            if (b.incidents.isEmpty)
              const _EmptyLine('No open incidents. All clear.')
            else
              for (final i in b.incidents) ...[
                _IncidentCard(incident: i, busy: _busyId == i.id, onChange: (s) => _change(i, s)),
                const SizedBox(height: 10),
              ],
            const SizedBox(height: 10),
            _Heading('Sites short-staffed', '${b.sites.length}'),
            if (b.sites.isEmpty)
              const _EmptyLine('Every site is at its required headcount.')
            else
              for (final s in b.sites)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(s.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: Text('${s.onDuty} on duty of ${s.required} required · ${s.sector}', style: const TextStyle(fontSize: 12)),
                  trailing: StatusBadge(s.shortfall > 0 ? '-${s.shortfall}' : 'Alert', color: Brand.danger),
                ),
            const SizedBox(height: 10),
            _Heading('Absences today', '${b.absencesToday.length}'),
            if (b.absencesToday.isEmpty) const _EmptyLine('No absences logged today.') else for (final e in b.absencesToday) _EntryTile(e),
            const SizedBox(height: 10),
            _Heading('Late today', '${b.lateToday.length}'),
            if (b.lateToday.isEmpty) const _EmptyLine('No late reports logged today.') else for (final e in b.lateToday) _EntryTile(e),
          ],
        ),
      ),
    );
  }
}

Future<String?> _askClosureNotes(BuildContext context, String incidentId) =>
    showDialog<String>(context: context, builder: (_) => _ClosureNotesDialog(incidentId: incidentId));

/// Owns its controller so it is disposed only after the dialog's exit animation has finished.
class _ClosureNotesDialog extends StatefulWidget {
  const _ClosureNotesDialog({required this.incidentId});

  final String incidentId;

  @override
  State<_ClosureNotesDialog> createState() => _ClosureNotesDialogState();
}

class _ClosureNotesDialogState extends State<_ClosureNotesDialog> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('Close ${widget.incidentId}'),
      content: TextField(
        controller: _controller,
        autofocus: true,
        maxLines: 3,
        textCapitalization: TextCapitalization.sentences,
        decoration: const InputDecoration(labelText: 'Closure notes (required)'),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('CANCEL')),
        FilledButton(
          onPressed: () {
            final text = _controller.text.trim();
            if (text.isNotEmpty) Navigator.pop(context, text);
          },
          child: const Text('CLOSE INCIDENT'),
        ),
      ],
    );
  }
}

String formatAge(int minutes) {
  if (minutes < 60) return '$minutes min';
  final h = minutes ~/ 60;
  if (h < 24) return '$h h ${minutes % 60} min';
  return '${h ~/ 24} d ${h % 24} h';
}

class _Summary extends StatelessWidget {
  const _Summary({required this.board});

  final OpsBoard board;

  @override
  Widget build(BuildContext context) {
    final tiles = <(String, String, Color)>[
      ('Open incidents', '${board.openIncidents}', Brand.danger),
      ('Critical open', '${board.criticalOpen}', board.criticalOpen > 0 ? Brand.danger : Brand.primary),
      ('Escalated', '${board.escalated}', Brand.gold),
      ('Oldest open', board.openIncidents == 0 ? '—' : formatAge(board.oldestOpenMinutes), Brand.gold),
      ('Short-staffed sites', '${board.sites.length}', board.sites.isNotEmpty ? Brand.danger : Brand.primary),
      ('On duty now', '${board.onDutyNow}', Brand.primary),
    ];
    return LayoutBuilder(
      builder: (context, c) {
        final width = (c.maxWidth - 10) / 2;
        return Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            for (final t in tiles)
              SizedBox(
                width: width,
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(t.$1, style: const TextStyle(color: Brand.textMuted, fontSize: 11)),
                        const SizedBox(height: 6),
                        Text(t.$2, style: Brand.numeral(size: 38, color: t.$3)),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading(this.title, this.count);

  final String title, count;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
            Text(count, style: const TextStyle(color: Brand.textMuted)),
          ],
        ),
      );
}

class _EmptyLine extends StatelessWidget {
  const _EmptyLine(this.message);

  final String message;

  @override
  Widget build(BuildContext context) =>
      Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text(message, style: const TextStyle(color: Brand.textMuted)));
}

class _EntryTile extends StatelessWidget {
  const _EntryTile(this.entry);

  final OpsEntry entry;

  @override
  Widget build(BuildContext context) => ListTile(
        contentPadding: EdgeInsets.zero,
        dense: true,
        title: Text('${entry.officerName} — ${entry.siteName}', style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text('${entry.shift} · ${entry.note}', style: const TextStyle(fontSize: 12)),
      );
}

class _IncidentCard extends StatelessWidget {
  const _IncidentCard({required this.incident, required this.busy, required this.onChange});

  final OpsIncident incident;
  final bool busy;
  final ValueChanged<String> onChange;

  @override
  Widget build(BuildContext context) {
    final i = incident;
    final color = i.isUrgent ? Brand.danger : Brand.gold;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 6,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                StatusBadge(i.severity, color: color),
                if (i.isEscalated) const StatusBadge('Escalated', color: Brand.danger, icon: Icons.priority_high_rounded),
                Text('${i.category} · ${i.subType}', style: const TextStyle(fontSize: 12, color: Brand.textMuted)),
              ],
            ),
            const SizedBox(height: 8),
            Text(i.siteName, style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text(i.description, maxLines: 3, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Brand.textMuted, fontSize: 13)),
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(Icons.schedule_rounded, size: 14, color: Brand.textDim),
                const SizedBox(width: 4),
                Text('Open ${formatAge(i.ageMinutes)}', style: const TextStyle(fontSize: 12, color: Brand.textDim)),
                const Spacer(),
                if (i.police) const Padding(padding: EdgeInsets.only(left: 6), child: Icon(Icons.local_police_rounded, size: 16, color: Brand.textDim)),
                if (i.hospital) const Padding(padding: EdgeInsets.only(left: 6), child: Icon(Icons.local_hospital_rounded, size: 16, color: Brand.textDim)),
                if (i.fire) const Padding(padding: EdgeInsets.only(left: 6), child: Icon(Icons.local_fire_department_rounded, size: 16, color: Brand.textDim)),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                if (!i.isEscalated)
                  Expanded(
                    child: OutlinedButton(
                      onPressed: busy ? null : () => onChange('Escalated'),
                      child: const Text('ESCALATE'),
                    ),
                  ),
                if (!i.isEscalated) const SizedBox(width: 10),
                Expanded(
                  child: FilledButton(
                    onPressed: busy ? null : () => onChange('Closed'),
                    child: busy
                        ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Text('CLOSE'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
