import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../common/widgets.dart';
import '../core/location_service.dart';
import '../core/models.dart';
import '../core/providers.dart';
import '../core/theme.dart';

class AttendanceScreen extends ConsumerStatefulWidget {
  const AttendanceScreen({super.key});

  @override
  ConsumerState<AttendanceScreen> createState() => _AttendanceScreenState();
}

class _AttendanceScreenState extends ConsumerState<AttendanceScreen> {
  String? _siteId;
  String _shift = shifts.first;
  bool _busy = false;
  String? _error;

  Future<void> _refresh() async {
    ref.invalidate(attendanceProvider);
    ref.invalidate(sitesProvider);
    ref.invalidate(kpisProvider);
    await ref.read(attendanceProvider.future).catchError((_) => const Attendance(active: null, history: []));
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
      await _refresh();
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _checkIn(AppUser user, String siteId) => _run(() async {
        final position = await currentPosition(); // null if unavailable: we send no coordinates
        await ref.read(repositoryProvider).checkIn(
              epf: user.epf,
              siteId: siteId,
              shift: _shift,
              lat: position?.lat,
              lng: position?.lng,
            );
        if (mounted) showSnack(context, 'Checked in. Stay safe out there.');
      });

  Future<void> _checkOut(int recordId) => _run(() async {
        await ref.read(repositoryProvider).checkOut(recordId);
        if (mounted) showSnack(context, 'Shift closed.');
      });

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authControllerProvider).value;
    final attendance = ref.watch(attendanceProvider);
    final sites = ref.watch(sitesProvider);

    if (user == null) return const SizedBox.shrink();

    return RefreshIndicator(
      onRefresh: _refresh,
      child: AsyncBody<Attendance>(
        value: attendance,
        onRetry: _refresh,
        builder: (data) {
          final siteList = sites.value ?? const <Site>[];
          final active = data.active;
          final activeSiteName = active == null
              ? null
              : siteList.where((s) => s.siteId == active.siteId).map((s) => s.name).firstOrNull ?? active.siteId;

          return ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
            children: [
              if (active != null)
                _ActiveShiftCard(
                  siteName: activeSiteName!,
                  shift: active.shift,
                  since: active.checkInTime,
                  busy: _busy,
                  onCheckOut: () => _checkOut(active.id),
                )
              else
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Text('Start your shift', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                        const SizedBox(height: 4),
                        const Text('Your check-in updates the live on-duty count for the site.',
                            style: TextStyle(color: Brand.textMuted, fontSize: 12)),
                        const SizedBox(height: 16),
                        PickerField<String>(
                          label: 'Site',
                          value: _siteId ?? siteList.map((s) => s.siteId).firstOrNull,
                          items: [for (final s in siteList) s.siteId],
                          labelOf: (id) => siteList.firstWhere((s) => s.siteId == id).name,
                          onChanged: _busy ? null : (v) => setState(() => _siteId = v),
                        ),
                        const SizedBox(height: 12),
                        PickerField<String>(
                          label: 'Shift',
                          value: _shift,
                          items: shifts,
                          labelOf: (s) => s,
                          onChanged: _busy ? null : (v) => setState(() => _shift = v ?? _shift),
                        ),
                        if (_error != null) ...[const SizedBox(height: 12), ErrorBanner(_error!)],
                        const SizedBox(height: 16),
                        FilledButton.icon(
                          onPressed: _busy || siteList.isEmpty
                              ? null
                              : () => _checkIn(user, _siteId ?? siteList.first.siteId),
                          style: FilledButton.styleFrom(backgroundColor: Brand.success, foregroundColor: Colors.white),
                          icon: _busy
                              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.5))
                              : const Icon(Icons.login_rounded),
                          label: const Text('CHECK IN — ON DUTY'),
                        ),
                      ],
                    ),
                  ),
                ),
              if (active != null && _error != null) ...[const SizedBox(height: 12), ErrorBanner(_error!)],
              const SizedBox(height: 20),
              const Text('RECENT SHIFTS',
                  style: TextStyle(color: Brand.textMuted, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.8)),
              const SizedBox(height: 8),
              if (data.history.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 24),
                  child: EmptyState(icon: Icons.history_toggle_off_rounded, message: 'No shifts recorded yet.'),
                ),
              for (final h in data.history) _HistoryTile(entry: h),
            ],
          );
        },
      ),
    );
  }
}

class _ActiveShiftCard extends StatelessWidget {
  const _ActiveShiftCard({
    required this.siteName,
    required this.shift,
    required this.since,
    required this.busy,
    required this.onCheckOut,
  });

  final String siteName, shift;
  final DateTime? since;
  final bool busy;
  final VoidCallback onCheckOut;

  @override
  Widget build(BuildContext context) {
    return Card(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: Brand.success.withValues(alpha: 0.5)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Row(children: [
              StatusBadge('ON DUTY', color: Brand.success, icon: Icons.circle),
            ]),
            const SizedBox(height: 12),
            Text(siteName, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            const SizedBox(height: 4),
            Text(shift, style: const TextStyle(color: Brand.textMuted)),
            Text('Since ${formatTime(since)}', style: const TextStyle(color: Brand.textMuted, fontSize: 12)),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: busy ? null : onCheckOut,
              style: FilledButton.styleFrom(backgroundColor: Brand.danger, foregroundColor: Colors.white),
              icon: busy
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.5))
                  : const Icon(Icons.logout_rounded),
              label: const Text('CHECK OUT — END SHIFT'),
            ),
          ],
        ),
      ),
    );
  }
}

class _HistoryTile extends StatelessWidget {
  const _HistoryTile({required this.entry});

  final AttendanceEntry entry;

  @override
  Widget build(BuildContext context) {
    final open = entry.checkOutTime == null;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Card(
        child: ListTile(
          leading: Icon(open ? Icons.timelapse_rounded : Icons.check_circle_outline_rounded,
              color: open ? Brand.success : Brand.textMuted),
          title: Text(entry.siteName, style: const TextStyle(fontWeight: FontWeight.w600)),
          subtitle: Text(
            '${entry.shift}\n${formatDateTime(entry.checkInTime)} → ${open ? 'in progress' : formatTime(entry.checkOutTime)}',
            style: const TextStyle(fontSize: 12, height: 1.4),
          ),
          isThreeLine: true,
        ),
      ),
    );
  }
}
