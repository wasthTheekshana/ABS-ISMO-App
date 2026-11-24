import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../common/widgets.dart';
import '../core/api_client.dart';
import '../core/models.dart';
import '../core/providers.dart';
import '../core/theme.dart';
import '../core/visit_tracker.dart';

/// Site rounds for Visiting Officers (SRS FR-14): arrive at a site, leave it, and see today's visits.
/// While a visit is open the app shares the officer's location every minute (see [VisitTracker]).
class VisitsScreen extends ConsumerStatefulWidget {
  const VisitsScreen({super.key});

  @override
  ConsumerState<VisitsScreen> createState() => _VisitsScreenState();
}

class _VisitsScreenState extends ConsumerState<VisitsScreen> {
  String? _siteId;
  bool _busy = false;
  Timer? _clock;

  @override
  void initState() {
    super.initState();
    // Refreshes the "minutes on site" figure.
    _clock = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _clock?.cancel();
    super.dispose();
  }

  Future<void> _arrive(String siteId) async {
    setState(() => _busy = true);
    try {
      final position = await ref.read(positionSourceProvider)();
      if (position == null) {
        if (mounted) showSnack(context, 'Your location is needed to record the arrival. Turn location on and try again.', error: true);
        return;
      }
      final result = await ref.read(repositoryProvider).arrive(siteId: siteId, lat: position.lat, lng: position.lng);
      ref.read(visitTrackerProvider.notifier).arrived();
      ref.invalidate(visitsProvider);
      if (mounted) showSnack(context, result.message, error: result.onSite == false);
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
      if (e.isConflict) ref.invalidate(visitsProvider); // already open somewhere: show it
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _depart(SiteVisit visit) async {
    setState(() => _busy = true);
    try {
      // A departure without a fix is still recorded: leaving must never be blocked by GPS.
      final position = await ref.read(positionSourceProvider)();
      await ref.read(repositoryProvider).depart(visit.id, lat: position?.lat, lng: position?.lng);
      ref.read(visitTrackerProvider.notifier).departed();
      ref.invalidate(visitsProvider);
      if (mounted) showSnack(context, 'Departure recorded for ${visit.siteName}');
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final visits = ref.watch(visitsProvider);
    final tracker = ref.watch(visitTrackerProvider);
    final sites = ref.watch(sitesProvider).value ?? const <Site>[];
    final siteId = _siteId ?? sites.firstOrNull?.siteId;

    return AsyncBody<VisitsState>(
      value: visits,
      onRetry: () => ref.invalidate(visitsProvider),
      builder: (state) => RefreshIndicator(
        onRefresh: () async => ref.refresh(visitsProvider.future),
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (state.open != null)
              _OpenVisitCard(visit: state.open!, tracker: tracker, busy: _busy, onDepart: () => _depart(state.open!))
            else
              _ArriveCard(
                sites: sites,
                siteId: siteId,
                busy: _busy,
                onSite: (v) => setState(() => _siteId = v),
                onArrive: siteId == null ? null : () => _arrive(siteId),
              ),
            const SizedBox(height: 20),
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text("Today's visits (${state.today.length})", style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
            ),
            if (state.today.isEmpty)
              const Text('No visits yet today.', style: TextStyle(color: Brand.textMuted))
            else
              for (final v in state.today) _VisitTile(v),
          ],
        ),
      ),
    );
  }
}

String _time(DateTime t) => DateFormat('HH:mm').format(t);

class _ArriveCard extends StatelessWidget {
  const _ArriveCard({required this.sites, required this.siteId, required this.busy, required this.onSite, required this.onArrive});

  final List<Site> sites;
  final String? siteId;
  final bool busy;
  final ValueChanged<String?> onSite;
  final VoidCallback? onArrive;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Start a site visit', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
            const SizedBox(height: 4),
            const Text(
              'Arrive when you reach the site. Your location is shared while the visit is open.',
              style: TextStyle(color: Brand.textMuted, fontSize: 12),
            ),
            const SizedBox(height: 14),
            if (sites.isEmpty)
              const Text('No sites are assigned to you.', style: TextStyle(color: Brand.textMuted))
            else
              DropdownButtonFormField<String>(
                initialValue: siteId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Site'),
                items: [for (final s in sites) DropdownMenuItem(value: s.siteId, child: Text(s.name, overflow: TextOverflow.ellipsis))],
                onChanged: busy ? null : onSite,
              ),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: busy ? null : onArrive,
                icon: busy
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.pin_drop_rounded),
                label: const Text('ARRIVE'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OpenVisitCard extends StatelessWidget {
  const _OpenVisitCard({required this.visit, required this.tracker, required this.busy, required this.onDepart});

  final SiteVisit visit;
  final VisitTrackerState tracker;
  final bool busy;
  final VoidCallback onDepart;

  @override
  Widget build(BuildContext context) {
    final minutes = DateTime.now().difference(visit.arrivedAt).inMinutes;
    return Card(
      color: Brand.primary.withValues(alpha: 0.10),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const StatusBadge('Visit in progress', color: Brand.primary, icon: Icons.radio_button_checked_rounded),
            const SizedBox(height: 10),
            Text(visit.siteName, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            const SizedBox(height: 4),
            Text('Arrived ${_time(visit.arrivedAt)} · ${minutes < 0 ? 0 : minutes} min on site', style: const TextStyle(color: Brand.textMuted)),
            if (visit.travelKm > 0)
              Text('Travelled ${visit.travelKm.toStringAsFixed(1)} km since your last visit', style: const TextStyle(color: Brand.textMuted, fontSize: 12)),
            if (visit.onSite == false)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: StatusBadge(
                  'Arrived ${visit.distanceFromSiteM ?? '?'} m from the site',
                  color: Brand.danger,
                  icon: Icons.warning_amber_rounded,
                ),
              ),
            const SizedBox(height: 10),
            Row(
              children: [
                Icon(
                  tracker.pingFailures > 0 ? Icons.location_off_rounded : Icons.my_location_rounded,
                  size: 14,
                  color: tracker.pingFailures > 0 ? Brand.gold : Brand.textDim,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    tracker.pingFailures > 0
                        ? 'Location is not reaching the server (${tracker.pingFailures} missed). Check location and signal.'
                        : tracker.lastPing == null
                            ? 'Sharing your location every minute'
                            : 'Location shared at ${_time(tracker.lastPing!)}',
                    style: const TextStyle(fontSize: 12, color: Brand.textDim),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: busy ? null : onDepart,
                icon: busy
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.logout_rounded),
                label: const Text('DEPART'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _VisitTile extends StatelessWidget {
  const _VisitTile(this.visit);

  final SiteVisit visit;

  @override
  Widget build(BuildContext context) {
    final end = visit.departedAt == null ? 'in progress' : _time(visit.departedAt!);
    final details = [
      '${_time(visit.arrivedAt)} – $end',
      if (visit.durationMinutes != null) '${visit.durationMinutes} min',
      if (visit.travelKm > 0) '${visit.travelKm.toStringAsFixed(1)} km travelled',
    ].join(' · ');
    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(visit.siteName, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(details, style: const TextStyle(fontSize: 12)),
      trailing: visit.onSite == null
          ? null
          : StatusBadge(visit.onSite! ? 'On site' : 'Off site', color: visit.onSite! ? Brand.primary : Brand.danger),
    );
  }
}
