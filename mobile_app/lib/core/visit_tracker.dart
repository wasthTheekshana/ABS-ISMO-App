import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'location_service.dart';
import 'providers.dart';

/// One device position, or null when none is available (location off, permission denied, no fix).
typedef PositionSource = Future<({double lat, double lng})?> Function();

/// Where positions come from. A provider so tests can supply fixed ones instead of real GPS.
final positionSourceProvider = Provider<PositionSource>((ref) => currentPosition);

/// How often a location fix is sent while a visit is open (SRS FR-8: live map).
final visitPingIntervalProvider = Provider<Duration>((ref) => const Duration(seconds: 60));

class VisitTrackerState {
  const VisitTrackerState({this.active = false, this.lastPing, this.pingFailures = 0});

  /// A visit is open, so location fixes are being sent.
  final bool active;
  final DateTime? lastPing;

  /// Consecutive pings that did not reach the server (no signal, no fix). Reset on success.
  final int pingFailures;
}

/// Sends a location fix every minute while a Visiting Officer has an open site visit, whichever tab
/// they are on. It restores itself after an app restart by asking the server whether a visit is open.
///
/// This runs while the app process is alive. Tracking with the screen off needs an Android
/// foreground service, which is not part of this build.
class VisitTracker extends Notifier<VisitTrackerState> {
  Timer? _timer;

  /// Bumped on every local arrive/depart so a slower server check cannot undo a newer local change.
  int _changes = 0;

  @override
  VisitTrackerState build() {
    ref.onDispose(() => _timer?.cancel());
    final user = ref.watch(authControllerProvider).value;
    if (user == null || !user.canVisit || user.mustChangePassword) return const VisitTrackerState();
    Future.microtask(sync);
    return const VisitTrackerState();
  }

  /// Asks the server whether a visit is open and starts or stops pinging to match.
  Future<void> sync() async {
    final before = _changes;
    try {
      final visits = await ref.read(repositoryProvider).myVisits();
      if (!ref.mounted) return; // signed out while we were asking
      // The officer arrived or departed while we were asking: their action is newer than this answer.
      if (before == _changes) _setActive(visits.open != null);
    } catch (_) {
      // Offline or signed out: keep whatever we were doing; the next sync corrects it.
    }
  }

  void arrived() {
    _changes++;
    _setActive(true);
  }

  void departed() {
    _changes++;
    _setActive(false);
  }

  void _setActive(bool active) {
    if (active == state.active && (_timer != null) == active) return;
    _timer?.cancel();
    _timer = active ? Timer.periodic(ref.read(visitPingIntervalProvider), (_) => _ping()) : null;
    state = VisitTrackerState(active: active, lastPing: active ? state.lastPing : null);
  }

  Future<void> _ping() async {
    if (!state.active) return;
    final position = await ref.read(positionSourceProvider)();
    // Signed out, or the visit ended, while we were waiting for a fix.
    if (!ref.mounted || !state.active) return;
    if (position == null) {
      state = VisitTrackerState(active: true, lastPing: state.lastPing, pingFailures: state.pingFailures + 1);
      return;
    }
    try {
      await ref.read(repositoryProvider).ping(lat: position.lat, lng: position.lng);
      if (!ref.mounted) return;
      state = VisitTrackerState(active: true, lastPing: DateTime.now());
    } catch (_) {
      if (!ref.mounted) return;
      state = VisitTrackerState(active: true, lastPing: state.lastPing, pingFailures: state.pingFailures + 1);
    }
  }
}

final visitTrackerProvider = NotifierProvider<VisitTracker, VisitTrackerState>(VisitTracker.new);
