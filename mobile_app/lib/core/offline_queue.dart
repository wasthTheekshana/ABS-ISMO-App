import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api_client.dart';
import 'models.dart';
import 'providers.dart';

/// A report the officer filed while the server was unreachable. It is sent, in order,
/// as soon as the connection returns. Queues are stored per user so one officer's
/// reports are never submitted under another officer's session.
class PendingReport {
  const PendingReport({required this.kind, required this.payload, required this.createdAt, this.rejection});

  final RecordKind kind;
  final Map<String, dynamic> payload;
  final DateTime createdAt;

  /// Set when the server refused the report (validation etc.) — it will not be retried.
  final String? rejection;

  PendingReport rejectedWith(String message) =>
      PendingReport(kind: kind, payload: payload, createdAt: createdAt, rejection: message);

  Map<String, dynamic> toJson() => {
        'kind': kind.name,
        'payload': payload,
        'createdAt': createdAt.toIso8601String(),
        'rejection': rejection,
      };

  static PendingReport? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final kind = RecordKind.values.where((k) => k.name == raw['kind']).firstOrNull;
    final payload = raw['payload'];
    final created = DateTime.tryParse('${raw['createdAt']}');
    if (kind == null || payload is! Map || created == null) return null;
    return PendingReport(
      kind: kind,
      payload: Map<String, dynamic>.from(payload),
      createdAt: created,
      rejection: raw['rejection'] as String?,
    );
  }

  String get label => switch (kind) {
        RecordKind.absence => 'Absence report',
        RecordKind.late => 'Late report',
        RecordKind.incident => 'Incident report',
        RecordKind.inspection => 'Site inspection',
      };
}

class PendingState {
  const PendingState({this.queued = const [], this.rejected = const [], this.syncing = false});

  final List<PendingReport> queued;
  final List<PendingReport> rejected;
  final bool syncing;

  PendingState copyWith({List<PendingReport>? queued, List<PendingReport>? rejected, bool? syncing}) =>
      PendingState(
        queued: queued ?? this.queued,
        rejected: rejected ?? this.rejected,
        syncing: syncing ?? this.syncing,
      );
}

/// True when the failure means "could not reach the server" rather than "server said no".
bool isNetworkFailure(Object e) => e is ApiException && e.status == null;

class PendingReportsController extends Notifier<PendingState> {
  static const _retryEvery = Duration(seconds: 30);

  Timer? _timer;
  String? _epf;

  String get _key => 'pending_reports_$_epf';

  @override
  PendingState build() {
    final user = ref.watch(authControllerProvider).value;
    ref.onDispose(() => _timer?.cancel());
    _epf = user?.epf;
    if (user == null) return const PendingState();

    _load();
    _timer = Timer.periodic(_retryEvery, (_) => flush());
    return const PendingState();
  }

  Future<void> _load() async {
    final epf = _epf;
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_key);
      if (raw == null || !ref.mounted || epf != _epf) return;

      final all = [for (final item in jsonDecode(raw) as List) ?PendingReport.tryParse(item)];
      state = PendingState(
        queued: [for (final r in all) if (r.rejection == null) r],
        rejected: [for (final r in all) if (r.rejection != null) r],
      );
      unawaited(flush());
    } catch (_) {
      // Unreadable storage must never block the app; start with an empty queue.
    }
  }

  Future<void> _persist() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final all = [...state.queued, ...state.rejected];
      if (all.isEmpty) {
        await prefs.remove(_key);
      } else {
        await prefs.setString(_key, jsonEncode([for (final r in all) r.toJson()]));
      }
    } catch (_) {}
  }

  Future<void> enqueue(RecordKind kind, Map<String, dynamic> payload) async {
    final report = PendingReport(kind: kind, payload: payload, createdAt: DateTime.now());
    state = state.copyWith(queued: [...state.queued, report]);
    await _persist();
  }

  /// Removes a refused report the officer has acknowledged.
  Future<void> dismissRejected(PendingReport report) async {
    state = state.copyWith(rejected: [...state.rejected]..remove(report));
    await _persist();
  }

  /// Sends queued reports oldest-first. Stops at the first network failure so order is
  /// preserved; a report the server refuses is moved to [PendingState.rejected].
  Future<void> flush() async {
    if (state.syncing || state.queued.isEmpty) return;
    state = state.copyWith(syncing: true);

    final repo = ref.read(repositoryProvider);
    var sentAny = false;

    for (final report in [...state.queued]) {
      if (!ref.mounted) return;
      try {
        await repo.submit(report.kind, report.payload);
        sentAny = true;
        state = state.copyWith(queued: [...state.queued]..remove(report));
      } on ApiException catch (e) {
        if (e.status == null || e.isUnauthorized) break; // offline, or session ended: retry later
        // 409: the server already holds this record (e.g. an earlier attempt landed).
        final queued = [...state.queued]..remove(report);
        state = e.isConflict
            ? state.copyWith(queued: queued)
            : state.copyWith(queued: queued, rejected: [...state.rejected, report.rejectedWith(e.message)]);
      } catch (_) {
        break;
      }
    }

    if (!ref.mounted) return;
    state = state.copyWith(syncing: false);
    await _persist();

    if (sentAny) {
      ref.invalidate(auditLogProvider);
      ref.invalidate(sitesProvider);
      ref.invalidate(kpisProvider);
    }
  }
}

final pendingReportsProvider =
    NotifierProvider<PendingReportsController, PendingState>(PendingReportsController.new);
