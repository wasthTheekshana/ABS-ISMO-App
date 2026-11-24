/// Typed views of the ISOMS REST API payloads. Parsing is deliberately tolerant:
/// Postgres COUNT/SUM values arrive as strings, so numbers go through [_int].
library;

int _int(Object? v, [int fallback = 0]) {
  if (v is int) return v;
  if (v is num) return v.toInt();
  return int.tryParse('$v') ?? fallback;
}

double _double(Object? v) => v is num ? v.toDouble() : double.tryParse('$v') ?? 0;

String _str(Object? v, [String fallback = '']) => v == null ? fallback : '$v';

DateTime? _date(Object? v) => v == null ? null : DateTime.tryParse('$v')?.toLocal();

/// Roles that see the dashboard KPI strip on the phone.
const managementRoles = {'MD', 'GM', 'AGM', 'SM', 'CONTROL_ROOM'};

/// Roles allowed to log guard absence and late reporting (SRS FR-4, FR-5).
const attendanceLoggingRoles = {'VO', 'NVO', 'SM', 'CONTROL_ROOM'};

/// Roles allowed to perform a site inspection (SRS FR-15).
const inspectionRoles = {'VO', 'NVO', 'SM'};

/// Roles allowed to report an incident; guards report for their own site (SRS UC-3).
const incidentReportRoles = {'MD', 'GM', 'AGM', 'SM', 'VO', 'NVO', 'CONTROL_ROOM', 'SECURITY_GUARD'};

class AppUser {
  const AppUser({
    required this.epf,
    required this.name,
    required this.role,
    required this.title,
    required this.region,
    required this.sector,
    this.mustChangePassword = false,
  });

  factory AppUser.fromJson(Map<String, dynamic> j) => AppUser(
        epf: _str(j['epf']),
        name: _str(j['name']),
        role: _str(j['role']),
        title: _str(j['title']),
        region: _str(j['region']),
        sector: _str(j['sector']),
        mustChangePassword: j['mustChangePassword'] == true,
      );

  final String epf, name, role, title, region, sector;

  /// True while the account still has the shared initial passcode; the server blocks
  /// every other call until a personal one is chosen.
  final bool mustChangePassword;

  bool get isManagement => managementRoles.contains(role);

  /// SRS FR-4/FR-5: only these roles may log guard absence and late reporting.
  /// The server enforces the same list; this just hides the buttons.
  bool get canLogAttendance => attendanceLoggingRoles.contains(role);
  bool get canInspect => inspectionRoles.contains(role);
  bool get canReportIncident => incidentReportRoles.contains(role);

  /// A guard works from their own site: check-in and incident reports only.
  bool get isGuard => role == 'SECURITY_GUARD';

  /// Clients use the web portal; the phone app has nothing for them yet.
  bool get isClient => role == 'CLIENT';

  /// Control Room works from the Operations tab (live incident queue, short-staffed sites).
  bool get isControlRoom => role == 'CONTROL_ROOM';

  /// Visiting Officers record arrival and departure on site rounds and share their location (FR-14).
  bool get canVisit => role == 'VO' || role == 'NVO';
  String get initials {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    return (parts.first[0] + (parts.length > 1 ? parts.last[0] : '')).toUpperCase();
  }
}

class Site {
  const Site({
    required this.siteId,
    required this.name,
    required this.sector,
    required this.region,
    required this.location,
    required this.requiredOfficers,
    required this.currentOnDuty,
    required this.shortfall,
    required this.status,
  });

  factory Site.fromJson(Map<String, dynamic> j) => Site(
        siteId: _str(j['siteId']),
        name: _str(j['name']),
        sector: _str(j['sector']),
        region: _str(j['region']),
        location: _str(j['location']),
        requiredOfficers: _int(j['requiredOfficers']),
        currentOnDuty: _int(j['currentOnDuty']),
        shortfall: _int(j['shortfall']),
        status: _str(j['status']),
      );

  final String siteId, name, sector, region, location, status;
  final int requiredOfficers, currentOnDuty, shortfall;

  bool get hasShortfall => shortfall > 0;
}

class Officer {
  const Officer({required this.epf, required this.name, required this.rank, required this.siteId});

  factory Officer.fromJson(Map<String, dynamic> j) => Officer(
        epf: _str(j['epf']),
        name: _str(j['name']),
        rank: _str(j['rank']),
        siteId: _str(j['siteId']),
      );

  final String epf, name, rank, siteId;
}

class ActiveShift {
  const ActiveShift({required this.id, required this.siteId, required this.shift, required this.checkInTime});

  factory ActiveShift.fromJson(Map<String, dynamic> j) => ActiveShift(
        id: _int(j['id']),
        siteId: _str(j['siteId']),
        shift: _str(j['shift']),
        checkInTime: _date(j['checkInTime']),
      );

  final int id;
  final String siteId, shift;
  final DateTime? checkInTime;
}

class AttendanceEntry {
  const AttendanceEntry({
    required this.id,
    required this.siteName,
    required this.shift,
    required this.checkInTime,
    required this.checkOutTime,
    required this.status,
  });

  factory AttendanceEntry.fromJson(Map<String, dynamic> j) => AttendanceEntry(
        id: _int(j['id']),
        siteName: _str(j['siteName'], 'Unknown site'),
        shift: _str(j['shift']),
        checkInTime: _date(j['checkInTime']),
        checkOutTime: _date(j['checkOutTime']),
        status: _str(j['status']),
      );

  final int id;
  final String siteName, shift, status;
  final DateTime? checkInTime, checkOutTime;
}

class Attendance {
  const Attendance({required this.active, required this.history});

  factory Attendance.fromJson(Map<String, dynamic> j) => Attendance(
        active: j['activeShift'] is Map<String, dynamic>
            ? ActiveShift.fromJson(j['activeShift'] as Map<String, dynamic>)
            : null,
        history: [
          for (final h in (j['history'] as List? ?? const []))
            AttendanceEntry.fromJson(h as Map<String, dynamic>),
        ],
      );

  final ActiveShift? active;
  final List<AttendanceEntry> history;
}

/// One row of the audit log, normalised across absence / late / incident / inspection.
enum RecordKind { absence, late, incident, inspection }

class AuditRecord {
  const AuditRecord({
    required this.kind,
    required this.id,
    required this.title,
    required this.subtitle,
    required this.siteName,
    required this.when,
    required this.submittedBy,
    this.badge,
  });

  factory AuditRecord.absence(Map<String, dynamic> j) => AuditRecord(
        kind: RecordKind.absence,
        id: _str(j['logId']),
        title: '${_str(j['officerName'])} — absent',
        subtitle: '${_str(j['reason'])} · ${_str(j['shift'])}',
        siteName: _str(j['siteName']),
        when: _date(j['timestamp']),
        submittedBy: _str(j['submittedBy']),
        badge: j['replacementDeployed'] == true ? 'Replacement deployed' : 'No replacement',
      );

  factory AuditRecord.late(Map<String, dynamic> j) => AuditRecord(
        kind: RecordKind.late,
        id: _str(j['logId']),
        title: '${_str(j['officerName'])} — ${_int(j['delayMinutes'])} min late',
        subtitle: '${_str(j['reason'])} · ${_str(j['shift'])}',
        siteName: _str(j['siteName']),
        when: _date(j['timestamp']),
        submittedBy: _str(j['submittedBy']),
      );

  factory AuditRecord.incident(Map<String, dynamic> j) => AuditRecord(
        kind: RecordKind.incident,
        id: _str(j['incidentId']),
        title: '${_str(j['category'])} — ${_str(j['subType'])}',
        subtitle: _str(j['description']),
        siteName: _str(j['siteName']),
        when: _date(j['createdAt']),
        submittedBy: _str(j['reportedBy']),
        badge: _str(j['severity']),
      );

  factory AuditRecord.inspection(Map<String, dynamic> j) => AuditRecord(
        kind: RecordKind.inspection,
        id: _str(j['inspectionId']),
        title: 'Site inspection — ${_str(j['siteRating'])}',
        subtitle: _str(j['remarks'], 'No remarks'),
        siteName: _str(j['siteName']),
        when: _date(j['createdAt']),
        submittedBy: _str(j['inspectorName']),
        badge: _str(j['siteRating']),
      );

  final RecordKind kind;
  final String id, title, subtitle, siteName, submittedBy;
  final DateTime? when;
  final String? badge;
}

class MonthPoint {
  const MonthPoint(this.month, this.percentage);
  final String month;
  final double percentage;
}

class SiteKpi {
  const SiteKpi({
    required this.name,
    required this.sector,
    required this.currentAbsence,
    required this.currentLate,
    required this.percentage,
  });

  factory SiteKpi.fromJson(Map<String, dynamic> j) => SiteKpi(
        name: _str(j['name']),
        sector: _str(j['sector']),
        currentAbsence: _int(j['currentAbsenceCount']),
        currentLate: _int(j['currentLateCount']),
        percentage: _double(j['currentAbsenteeismPercentage']),
      );

  final String name, sector;
  final int currentAbsence, currentLate;
  final double percentage;
}

class ExecutiveKpis {
  const ExecutiveKpis({
    required this.totalRequired,
    required this.totalOnDuty,
    required this.totalShortfall,
    required this.totalAbsence,
    required this.totalLate,
    required this.absenteeism,
    required this.trend,
    required this.monthly,
    required this.sites,
  });

  factory ExecutiveKpis.fromJson(Map<String, dynamic> j) => ExecutiveKpis(
        totalRequired: _int(j['totalRequired']),
        totalOnDuty: _int(j['totalOnDuty']),
        totalShortfall: _int(j['totalShortfall']),
        totalAbsence: _int(j['totalAbsenceCount']),
        totalLate: _int(j['totalLateCount']),
        absenteeism: _double(j['absenteeismPercentage']),
        trend: _str(j['trend']),
        monthly: [
          for (final m in (j['monthlyTrend'] as List? ?? const []))
            MonthPoint(_str((m as Map)['month']), _double(m['absenteeismPercentage'])),
        ],
        sites: [
          for (final s in (j['siteBreakdown'] as List? ?? const []))
            SiteKpi.fromJson(s as Map<String, dynamic>),
        ],
      );

  final int totalRequired, totalOnDuty, totalShortfall, totalAbsence, totalLate;
  final double absenteeism;
  final String trend;
  final List<MonthPoint> monthly;
  final List<SiteKpi> sites;
}

// ── Control Room operations board (GET /control-room/board) ───────────────────

class OpsIncident {
  const OpsIncident({
    required this.id,
    required this.category,
    required this.subType,
    required this.severity,
    required this.status,
    required this.siteName,
    required this.description,
    required this.ageMinutes,
    required this.police,
    required this.hospital,
    required this.fire,
  });

  factory OpsIncident.fromJson(Map<String, dynamic> j) => OpsIncident(
        id: _str(j['incidentId']),
        category: _str(j['category']),
        subType: _str(j['subType']),
        severity: _str(j['severity'], 'Medium'),
        status: _str(j['status']),
        siteName: _str(j['siteName']),
        description: _str(j['description']),
        ageMinutes: _int(j['ageMinutes']),
        police: j['policeNotified'] == true,
        hospital: j['hospitalNotified'] == true,
        fire: j['fireNotified'] == true,
      );

  final String id, category, subType, severity, status, siteName, description;
  final int ageMinutes;
  final bool police, hospital, fire;

  bool get isEscalated => status == 'Escalated';
  bool get isUrgent => severity == 'Critical' || severity == 'High';
}

class OpsSite {
  const OpsSite({required this.name, required this.sector, required this.onDuty, required this.required, required this.shortfall});

  factory OpsSite.fromJson(Map<String, dynamic> j) => OpsSite(
        name: _str(j['name']),
        sector: _str(j['sector']),
        onDuty: _int(j['currentOnDuty']),
        required: _int(j['requiredOfficers']),
        shortfall: _int(j['shortfall']),
      );

  final String name, sector;
  final int onDuty, required, shortfall;
}

/// One absence or late report logged today.
class OpsEntry {
  const OpsEntry({required this.officerName, required this.siteName, required this.shift, required this.note});

  factory OpsEntry.absence(Map<String, dynamic> j) => OpsEntry(
        officerName: _str(j['officerName']),
        siteName: _str(j['siteName']),
        shift: _str(j['shift']),
        note: '${_str(j['reason'])} · ${j['replacementDeployed'] == true ? 'replaced' : 'NOT replaced'}',
      );

  factory OpsEntry.late(Map<String, dynamic> j) => OpsEntry(
        officerName: _str(j['officerName']),
        siteName: _str(j['siteName']),
        shift: _str(j['shift']),
        note: '${_int(j['delayMinutes'])} min late · ${_str(j['reason'])}',
      );

  final String officerName, siteName, shift, note;
}

class OpsBoard {
  const OpsBoard({
    required this.openIncidents,
    required this.criticalOpen,
    required this.escalated,
    required this.oldestOpenMinutes,
    required this.onDutyNow,
    required this.incidents,
    required this.sites,
    required this.absencesToday,
    required this.lateToday,
  });

  factory OpsBoard.fromJson(Map<String, dynamic> j) {
    final s = (j['summary'] as Map?)?.cast<String, dynamic>() ?? const {};
    List<T> list<T>(String key, T Function(Map<String, dynamic>) parse) =>
        [for (final e in (j[key] as List? ?? const [])) parse(e as Map<String, dynamic>)];
    return OpsBoard(
      openIncidents: _int(s['openIncidents']),
      criticalOpen: _int(s['criticalOpen']),
      escalated: _int(s['escalated']),
      oldestOpenMinutes: _int(s['oldestOpenMinutes']),
      onDutyNow: _int(s['onDutyNow']),
      incidents: list('incidents', OpsIncident.fromJson),
      sites: list('sites', OpsSite.fromJson),
      absencesToday: list('absencesToday', OpsEntry.absence),
      lateToday: list('lateToday', OpsEntry.late),
    );
  }

  final int openIncidents, criticalOpen, escalated, oldestOpenMinutes, onDutyNow;
  final List<OpsIncident> incidents;
  final List<OpsSite> sites;
  final List<OpsEntry> absencesToday, lateToday;
}

// ── GPS site visits (SRS FR-14) ───────────────────────────────────────────────

class SiteVisit {
  const SiteVisit({
    required this.id,
    required this.siteId,
    required this.siteName,
    required this.arrivedAt,
    required this.departedAt,
    required this.durationMinutes,
    required this.travelKm,
    required this.onSite,
    required this.distanceFromSiteM,
  });

  factory SiteVisit.fromJson(Map<String, dynamic> j) => SiteVisit(
        id: _str(j['visitId']),
        siteId: _str(j['siteId']),
        siteName: _str(j['siteName']),
        arrivedAt: _date(j['arrivedAt']) ?? DateTime.now(),
        departedAt: _date(j['departedAt']),
        durationMinutes: j['durationMinutes'] == null ? null : _int(j['durationMinutes']),
        travelKm: _double(j['travelKm']),
        onSite: j['onSite'] is bool ? j['onSite'] as bool : null,
        distanceFromSiteM: j['distanceFromSiteM'] == null ? null : _int(j['distanceFromSiteM']),
      );

  final String id, siteId, siteName;
  final DateTime arrivedAt;
  final DateTime? departedAt;
  final int? durationMinutes, distanceFromSiteM;
  final double travelKm;

  /// Inside the arrival zone; null when the site has no coordinates on record.
  final bool? onSite;

  bool get isOpen => departedAt == null;
}

class VisitsState {
  const VisitsState({required this.open, required this.today});

  factory VisitsState.fromJson(Map<String, dynamic> j) => VisitsState(
        open: j['open'] is Map<String, dynamic> ? SiteVisit.fromJson(j['open'] as Map<String, dynamic>) : null,
        today: [
          for (final v in (j['today'] as List? ?? const [])) SiteVisit.fromJson(v as Map<String, dynamic>),
        ],
      );

  final SiteVisit? open;
  final List<SiteVisit> today;
}

class ArrivalResult {
  const ArrivalResult({required this.visitId, required this.message, required this.onSite, required this.distanceFromSiteM, required this.travelKm});

  factory ArrivalResult.fromJson(Map<String, dynamic> j) => ArrivalResult(
        visitId: _str(j['visitId']),
        message: _str(j['message']),
        onSite: j['onSite'] is bool ? j['onSite'] as bool : null,
        distanceFromSiteM: j['distanceFromSiteM'] == null ? null : _int(j['distanceFromSiteM']),
        travelKm: _double(j['travelKm']),
      );

  final String visitId, message;
  final bool? onSite;
  final int? distanceFromSiteM;
  final double travelKm;
}
