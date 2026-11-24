import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:isoms_mobile/core/models.dart';
import 'package:isoms_mobile/core/providers.dart';
import 'package:isoms_mobile/core/repository.dart';
import 'package:isoms_mobile/features/ops_screen.dart';
import 'package:mocktail/mocktail.dart';

class _MockRepo extends Mock implements IsomsRepository {}

Map<String, dynamic> _incident(String id, {String severity = 'High', String status = 'Open & Investigating', int age = 45}) => {
      'incidentId': id,
      'category': 'Security',
      'subType': 'Theft',
      'severity': severity,
      'status': status,
      'siteName': 'Site $id',
      'description': 'Laptop taken from reception',
      'ageMinutes': age,
      'policeNotified': true,
      'hospitalNotified': false,
      'fireNotified': false,
    };

Map<String, dynamic> _json({List<Map<String, dynamic>>? incidents}) => {
      'summary': {
        'openIncidents': (incidents ?? [_incident('INC-1')]).length,
        'criticalOpen': 0,
        'escalated': 0,
        'oldestOpenMinutes': 45,
        'onDutyNow': 7,
      },
      'incidents': incidents ?? [_incident('INC-1')],
      'sites': [
        {'name': 'Cargills Main', 'sector': 'Sector 01', 'currentOnDuty': 6, 'requiredOfficers': 8, 'shortfall': 2},
      ],
      'absencesToday': [
        {'officerName': 'K. Silva', 'siteName': 'Cargills Main', 'shift': 'Day', 'reason': 'Sick', 'replacementDeployed': false},
      ],
      'lateToday': [
        {'officerName': 'N. Perera', 'siteName': 'Biyagama', 'shift': 'Night', 'delayMinutes': 25, 'reason': 'Bus'},
      ],
    };

void main() {
  group('OpsBoard.fromJson', () {
    test('parses the summary and every list', () {
      final b = OpsBoard.fromJson(_json(incidents: [_incident('INC-1', severity: 'Critical', status: 'Escalated')]));
      expect(b.openIncidents, 1);
      expect(b.onDutyNow, 7);
      expect(b.incidents.single.isEscalated, isTrue);
      expect(b.incidents.single.isUrgent, isTrue);
      expect(b.incidents.single.police, isTrue);
      expect(b.sites.single.shortfall, 2);
      expect(b.absencesToday.single.note, 'Sick · NOT replaced');
      expect(b.lateToday.single.note, '25 min late · Bus');
    });

    test('tolerates an empty board', () {
      final b = OpsBoard.fromJson({'summary': {}, 'incidents': [], 'sites': []});
      expect(b.incidents, isEmpty);
      expect(b.openIncidents, 0);
      expect(b.absencesToday, isEmpty);
    });

    test('Medium and Low incidents are not urgent', () {
      expect(OpsIncident.fromJson(_incident('X', severity: 'Medium')).isUrgent, isFalse);
      expect(OpsIncident.fromJson(_incident('X', severity: 'Low')).isUrgent, isFalse);
    });
  });

  test('formatAge picks a sensible unit', () {
    expect(formatAge(5), '5 min');
    expect(formatAge(125), '2 h 5 min');
    expect(formatAge(60 * 26), '1 d 2 h');
  });

  test('only CONTROL_ROOM isControlRoom', () {
    AppUser u(String role) => AppUser.fromJson({'epf': 'E', 'name': 'n', 'role': role, 'title': 't', 'region': 'r', 'sector': 's'});
    expect(u('CONTROL_ROOM').isControlRoom, isTrue);
    for (final r in ['MD', 'GM', 'AGM', 'SM', 'VO', 'NVO', 'SECURITY_GUARD', 'CLIENT']) {
      expect(u(r).isControlRoom, isFalse, reason: r);
    }
  });

  group('OpsScreen', () {
    late _MockRepo repo;

    setUp(() {
      repo = _MockRepo();
      when(() => repo.updateIncidentStatus(any(), any(), closureNotes: any(named: 'closureNotes'))).thenAnswer((_) async {});
    });

    Future<void> pump(WidgetTester tester, Map<String, dynamic> board) async {
      tester.view.physicalSize = const Size(800, 3000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            repositoryProvider.overrideWithValue(repo),
            opsBoardProvider.overrideWith((ref) async => OpsBoard.fromJson(board)),
          ],
          child: const MaterialApp(home: Scaffold(body: OpsScreen())),
        ),
      );
      await tester.pumpAndSettle();
    }

    // Disposes the screen so its 30 s refresh timer does not outlive the test.
    Future<void> finish(WidgetTester tester) async {
      await tester.pumpWidget(const SizedBox());
    }

    testWidgets('lists incidents, short-staffed sites and today\'s absences and lates', (tester) async {
      await pump(tester, _json());
      expect(find.text('Site INC-1'), findsOneWidget);
      expect(find.text('Cargills Main'), findsWidgets);
      expect(find.textContaining('K. Silva'), findsOneWidget);
      expect(find.textContaining('25 min late'), findsOneWidget);
      expect(find.text('ESCALATE'), findsOneWidget);
      expect(find.text('CLOSE'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('shows all-clear messages when nothing is open', (tester) async {
      await pump(tester, {'summary': {}, 'incidents': [], 'sites': [], 'absencesToday': [], 'lateToday': []});
      expect(find.text('No open incidents. All clear.'), findsOneWidget);
      expect(find.text('Every site is at its required headcount.'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('an already escalated incident has no ESCALATE button', (tester) async {
      await pump(tester, _json(incidents: [_incident('INC-9', status: 'Escalated')]));
      expect(find.text('ESCALATE'), findsNothing);
      expect(find.text('CLOSE'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('ESCALATE calls the server with the incident ID', (tester) async {
      await pump(tester, _json());
      await tester.tap(find.text('ESCALATE'));
      await tester.pumpAndSettle();
      verify(() => repo.updateIncidentStatus('INC-1', 'Escalated', closureNotes: null)).called(1);
      await finish(tester);
    });

    testWidgets('CLOSE needs notes: an empty dialog does not submit, notes do', (tester) async {
      await pump(tester, _json());
      await tester.tap(find.text('CLOSE'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('CLOSE INCIDENT'));
      await tester.pumpAndSettle();
      expect(find.text('CLOSE INCIDENT'), findsOneWidget, reason: 'dialog stays open without notes');
      verifyNever(() => repo.updateIncidentStatus(any(), any(), closureNotes: any(named: 'closureNotes')));

      await tester.enterText(find.byType(TextField), 'Laptop recovered');
      await tester.tap(find.text('CLOSE INCIDENT'));
      await tester.pumpAndSettle();
      verify(() => repo.updateIncidentStatus('INC-1', 'Closed', closureNotes: 'Laptop recovered')).called(1);
      await finish(tester);
    });

    testWidgets('cancelling the close dialog changes nothing', (tester) async {
      await pump(tester, _json());
      await tester.tap(find.text('CLOSE'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('CANCEL'));
      await tester.pumpAndSettle();
      verifyNever(() => repo.updateIncidentStatus(any(), any(), closureNotes: any(named: 'closureNotes')));
      await finish(tester);
    });
  });
}
