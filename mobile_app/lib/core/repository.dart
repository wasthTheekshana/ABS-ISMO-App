import 'api_client.dart';
import 'models.dart';

/// All server calls the app makes. Screens never touch Dio directly.
class IsomsRepository {
  const IsomsRepository(this._api);

  final ApiClient _api;

  // ── Auth ──────────────────────────────────────────────────────────────────
  Future<({String token, AppUser user})> login(String epf, String password) async {
    final res = await _api.post('/auth/login', body: {'epf': epf, 'password': password});
    return (
      token: res['token'] as String,
      user: AppUser.fromJson(res['user'] as Map<String, dynamic>),
    );
  }

  /// Sets a new passcode; the server replies with a fresh, unrestricted token.
  Future<({String token, AppUser user})> changePassword(String current, String next) async {
    final res = await _api.post('/auth/change-password', body: {'currentPassword': current, 'newPassword': next});
    return (
      token: res['token'] as String,
      user: AppUser.fromJson(res['user'] as Map<String, dynamic>),
    );
  }

  Future<AppUser> currentUser() async =>
      AppUser.fromJson((await _api.get('/auth/me'))['user'] as Map<String, dynamic>);

  // ── Reference data (scoped to the caller's role on the server) ────────────
  Future<List<Site>> sites() async => _list(await _api.get('/sites'), 'sites', Site.fromJson);

  Future<List<Officer>> officers() async =>
      _list(await _api.get('/officers'), 'officers', Officer.fromJson);

  Future<ExecutiveKpis> kpis() async =>
      ExecutiveKpis.fromJson((await _api.get('/kpis/executive'))['kpis'] as Map<String, dynamic>);

  // ── GPS site visits (Visiting Officers) ───────────────────────────────────
  Future<VisitsState> myVisits() async => VisitsState.fromJson(await _api.get('/visits/mine'));

  Future<ArrivalResult> arrive({required String siteId, required double lat, required double lng}) async =>
      ArrivalResult.fromJson(await _api.post('/visits/arrive', body: {'siteId': siteId, 'lat': lat, 'lng': lng}));

  /// Ends the visit. The location is optional: leaving without a fix must still work.
  Future<void> depart(String visitId, {double? lat, double? lng, String? notes}) =>
      _api.post('/visits/${Uri.encodeComponent(visitId)}/depart', body: {
        'lat': ?lat,
        'lng': ?lng,
        'notes': ?notes,
      });

  /// One periodic location fix while on a round.
  Future<void> ping({required double lat, required double lng, double? accuracy}) =>
      _api.post('/visits/ping', body: {'lat': lat, 'lng': lng, 'accuracy': ?accuracy});

  // ── Control Room ──────────────────────────────────────────────────────────
  Future<OpsBoard> opsBoard() async => OpsBoard.fromJson(await _api.get('/control-room/board'));

  /// Escalate, close (notes required) or reopen an incident.
  Future<void> updateIncidentStatus(String incidentId, String status, {String? closureNotes}) =>
      _api.patch('/incidents/${Uri.encodeComponent(incidentId)}/status', body: {
        'status': status,
        'closureNotes': ?closureNotes,
      });

  // ── Attendance ────────────────────────────────────────────────────────────
  Future<Attendance> attendance() async => Attendance.fromJson(await _api.get('/attendance/mine'));

  Future<void> checkIn({
    required String epf,
    required String siteId,
    required String shift,
    double? lat,
    double? lng,
  }) =>
      _api.post('/attendance/check-in', body: {
        'epf': epf,
        'siteId': siteId,
        'shift': shift,
        'gpsLat': ?lat,
        'gpsLng': ?lng,
      });

  Future<void> checkOut(int recordId) => _api.post('/attendance/check-out', body: {'recordId': recordId});

  // ── Reports. Each returns the server-issued record ID ─────────────────────
  Future<String> logAbsence(Map<String, dynamic> payload) async =>
      (await _api.post('/absence/log', body: payload))['logId'] as String;

  Future<String> logLate(Map<String, dynamic> payload) async =>
      (await _api.post('/late/log', body: payload))['logId'] as String;

  Future<String> reportIncident(Map<String, dynamic> payload) async =>
      (await _api.post('/incidents/report', body: payload))['incidentId'] as String;

  Future<String> submitInspection(Map<String, dynamic> payload) async =>
      (await _api.post('/inspections/submit', body: payload))['inspectionId'] as String;

  /// Sends any report kind; used by forms and by the offline queue when it replays.
  Future<String> submit(RecordKind kind, Map<String, dynamic> payload) => switch (kind) {
        RecordKind.absence => logAbsence(payload),
        RecordKind.late => logLate(payload),
        RecordKind.incident => reportIncident(payload),
        RecordKind.inspection => submitInspection(payload),
      };

  // ── Audit log ─────────────────────────────────────────────────────────────
  Future<List<AuditRecord>> auditLog(RecordKind kind) async => switch (kind) {
        RecordKind.absence =>
          _list(await _api.get('/absence/logs'), 'absenceLogs', AuditRecord.absence),
        RecordKind.late => _list(await _api.get('/late/logs'), 'lateLogs', AuditRecord.late),
        RecordKind.incident =>
          _list(await _api.get('/incidents/list'), 'incidents', AuditRecord.incident),
        RecordKind.inspection =>
          _list(await _api.get('/inspections/list'), 'inspections', AuditRecord.inspection),
      };

  List<T> _list<T>(Map<String, dynamic> body, String key, T Function(Map<String, dynamic>) parse) => [
        for (final item in (body[key] as List? ?? const [])) parse(item as Map<String, dynamic>),
      ];
}
