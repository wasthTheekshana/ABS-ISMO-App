import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:isoms_mobile/core/api_client.dart';
import 'package:isoms_mobile/core/models.dart';
import 'package:isoms_mobile/core/providers.dart';
import 'package:isoms_mobile/core/repository.dart';
import 'package:isoms_mobile/core/visit_tracker.dart';
import 'package:isoms_mobile/features/visits_screen.dart';
import 'package:mocktail/mocktail.dart';

class _MockRepo extends Mock implements IsomsRepository {}

class _FakeAuth extends AuthController {
  _FakeAuth(this.role);

  final String role;

  @override
  Future<AppUser?> build() async => AppUser.fromJson({'epf': 'EPF-1042', 'name': 'Chaminda', 'role': role, 'title': 't', 'region': 'r', 'sector': 's'});
}

Map<String, dynamic> _visit({String id = 'VISIT-1', bool open = true, bool? onSite = true, int? distance = 4, double travel = 0}) => {
      'visitId': id,
      'siteId': 'SITE-1',
      'siteName': 'Cargills Main',
      'arrivedAt': DateTime.now().subtract(const Duration(minutes: 20)).toUtc().toIso8601String(),
      'departedAt': open ? null : DateTime.now().toUtc().toIso8601String(),
      'durationMinutes': open ? null : 20,
      'travelKm': travel,
      'onSite': onSite,
      'distanceFromSiteM': distance,
    };

const _site = Site(
  siteId: 'SITE-1', name: 'Cargills Main', sector: 'Sector 01', region: 'Western', location: 'Fort',
  requiredOfficers: 8, currentOnDuty: 6, shortfall: 2, status: 'Alert',
);

({double lat, double lng}) _fix = (lat: 6.912, lng: 79.851);

void main() {
  group('visit models', () {
    test('parse an open visit with the geofence result', () {
      final v = SiteVisit.fromJson(_visit(onSite: false, distance: 320, travel: 4.25));
      expect(v.isOpen, isTrue);
      expect(v.onSite, isFalse);
      expect(v.distanceFromSiteM, 320);
      expect(v.travelKm, 4.25);
      expect(v.durationMinutes, isNull);
    });

    test('a site without coordinates leaves onSite null', () {
      final v = SiteVisit.fromJson(_visit(onSite: null, distance: null));
      expect(v.onSite, isNull);
      expect(v.distanceFromSiteM, isNull);
    });

    test('a completed visit is not open', () {
      expect(SiteVisit.fromJson(_visit(open: false)).isOpen, isFalse);
    });

    test('VisitsState handles no open visit and string numbers from the server', () {
      final s = VisitsState.fromJson({
        'open': null,
        'today': [_visit(open: false)..['travelKm'] = '3.5'],
      });
      expect(s.open, isNull);
      expect(s.today.single.travelKm, 3.5);
      expect(VisitsState.fromJson({}).today, isEmpty);
    });

    test('ArrivalResult keeps the server message and distance', () {
      final r = ArrivalResult.fromJson({'visitId': 'V', 'message': 'Arrival recorded', 'onSite': true, 'distanceFromSiteM': 12, 'travelKm': '1.2'});
      expect(r.message, 'Arrival recorded');
      expect(r.distanceFromSiteM, 12);
      expect(r.travelKm, 1.2);
    });

    test('only VO and NVO canVisit', () {
      AppUser u(String role) => AppUser.fromJson({'epf': 'E', 'name': 'n', 'role': role, 'title': 't', 'region': 'r', 'sector': 's'});
      expect(u('VO').canVisit, isTrue);
      expect(u('NVO').canVisit, isTrue);
      for (final r in ['MD', 'GM', 'AGM', 'SM', 'CONTROL_ROOM', 'SECURITY_GUARD', 'CLIENT']) {
        expect(u(r).canVisit, isFalse, reason: r);
      }
    });
  });

  group('VisitTracker', () {
    late _MockRepo repo;

    setUp(() {
      repo = _MockRepo();
      when(() => repo.ping(lat: any(named: 'lat'), lng: any(named: 'lng'), accuracy: any(named: 'accuracy'))).thenAnswer((_) async {});
    });

    ProviderContainer make({String role = 'VO', PositionSource? position, bool openVisit = false}) {
      when(() => repo.myVisits()).thenAnswer((_) async => VisitsState.fromJson({'open': openVisit ? _visit() : null, 'today': []}));
      final container = ProviderContainer(overrides: [
        authControllerProvider.overrideWith(() => _FakeAuth(role)),
        repositoryProvider.overrideWithValue(repo),
        positionSourceProvider.overrideWithValue(position ?? () async => _fix),
        visitPingIntervalProvider.overrideWithValue(const Duration(milliseconds: 40)),
      ]);
      addTearDown(container.dispose);
      return container;
    }

    Future<void> settle() => Future<void>.delayed(const Duration(milliseconds: 160));

    // The app builds the tracker at start-up, long before an arrival. Mirror that: build it and let
    // its first "is a visit open?" check finish before the test acts.
    Future<VisitTracker> start(ProviderContainer c) async {
      await c.read(authControllerProvider.future);
      final tracker = c.read(visitTrackerProvider.notifier);
      await Future<void>.delayed(const Duration(milliseconds: 15));
      return tracker;
    }

    test('stays idle when no visit is open', () async {
      final c = make();
      await c.read(authControllerProvider.future);
      c.read(visitTrackerProvider);
      await settle();
      expect(c.read(visitTrackerProvider).active, isFalse);
      verifyNever(() => repo.ping(lat: any(named: 'lat'), lng: any(named: 'lng'), accuracy: any(named: 'accuracy')));
    });

    test('pings repeatedly while a visit is open, with the device position', () async {
      final c = make();
      (await start(c)).arrived();
      await settle();
      expect(c.read(visitTrackerProvider).active, isTrue);
      expect(c.read(visitTrackerProvider).lastPing, isNotNull);
      verify(() => repo.ping(lat: 6.912, lng: 79.851, accuracy: any(named: 'accuracy'))).called(greaterThanOrEqualTo(2));
    });

    test('stops pinging once the officer departs', () async {
      final c = make();
      final tracker = await start(c);
      tracker.arrived();
      await settle();
      tracker.departed();
      clearInteractions(repo);
      await settle();
      expect(c.read(visitTrackerProvider).active, isFalse);
      verifyNever(() => repo.ping(lat: any(named: 'lat'), lng: any(named: 'lng'), accuracy: any(named: 'accuracy')));
    });

    test('restores tracking after a restart by asking the server for an open visit', () async {
      final c = make(openVisit: true);
      await c.read(authControllerProvider.future);
      c.read(visitTrackerProvider);
      await settle();
      expect(c.read(visitTrackerProvider).active, isTrue);
      verify(() => repo.ping(lat: any(named: 'lat'), lng: any(named: 'lng'), accuracy: any(named: 'accuracy'))).called(greaterThanOrEqualTo(1));
    });

    test('counts missed pings when there is no location fix, and sends nothing', () async {
      final c = make(position: () async => null);
      (await start(c)).arrived();
      await settle();
      expect(c.read(visitTrackerProvider).pingFailures, greaterThanOrEqualTo(2));
      verifyNever(() => repo.ping(lat: any(named: 'lat'), lng: any(named: 'lng'), accuracy: any(named: 'accuracy')));
    });

    test('counts missed pings when the server is unreachable, then recovers', () async {
      when(() => repo.ping(lat: any(named: 'lat'), lng: any(named: 'lng'), accuracy: any(named: 'accuracy')))
          .thenThrow(const ApiException('No connection'));
      final c = make();
      (await start(c)).arrived();
      await settle();
      expect(c.read(visitTrackerProvider).pingFailures, greaterThanOrEqualTo(2));

      when(() => repo.ping(lat: any(named: 'lat'), lng: any(named: 'lng'), accuracy: any(named: 'accuracy'))).thenAnswer((_) async {});
      await settle();
      expect(c.read(visitTrackerProvider).pingFailures, 0);
    });

    test('a slow "is a visit open?" answer cannot switch off a visit started meanwhile', () async {
      final c = make();
      final tracker = await start(c);
      // The server is slow and, being asked before the arrival was saved, says nothing is open.
      when(() => repo.myVisits()).thenAnswer((_) async {
        await Future<void>.delayed(const Duration(milliseconds: 60));
        return VisitsState.fromJson({'open': null, 'today': []});
      });
      final slow = tracker.sync();
      tracker.arrived();
      await slow;
      expect(c.read(visitTrackerProvider).active, isTrue);
    });

    test('never starts for a role that cannot do site visits', () async {
      final c = make(role: 'SM');
      await c.read(authControllerProvider.future);
      c.read(visitTrackerProvider);
      await settle();
      expect(c.read(visitTrackerProvider).active, isFalse);
      verifyNever(() => repo.myVisits());
    });
  });

  group('VisitsScreen', () {
    late _MockRepo repo;

    setUp(() {
      repo = _MockRepo();
      _fix = (lat: 6.912, lng: 79.851);
      when(() => repo.ping(lat: any(named: 'lat'), lng: any(named: 'lng'), accuracy: any(named: 'accuracy'))).thenAnswer((_) async {});
      when(() => repo.depart(any(), lat: any(named: 'lat'), lng: any(named: 'lng'), notes: any(named: 'notes'))).thenAnswer((_) async {});
    });

    Future<void> pump(WidgetTester tester, {VisitsState? state, PositionSource? position}) async {
      final current = state ?? VisitsState.fromJson({'open': null, 'today': []});
      when(() => repo.myVisits()).thenAnswer((_) async => current);
      tester.view.physicalSize = const Size(800, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(ProviderScope(
        overrides: [
          authControllerProvider.overrideWith(() => _FakeAuth('VO')),
          repositoryProvider.overrideWithValue(repo),
          sitesProvider.overrideWith((ref) async => [_site]),
          positionSourceProvider.overrideWithValue(position ?? () async => _fix),
          visitPingIntervalProvider.overrideWithValue(const Duration(hours: 1)),
        ],
        child: const MaterialApp(home: Scaffold(body: VisitsScreen())),
      ));
      await tester.pumpAndSettle();
    }

    Future<void> finish(WidgetTester tester) async => tester.pumpWidget(const SizedBox());

    testWidgets('offers ARRIVE with the officer\'s site when no visit is open', (tester) async {
      await pump(tester);
      expect(find.text('ARRIVE'), findsOneWidget);
      expect(find.text('DEPART'), findsNothing);
      expect(find.text('No visits yet today.'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('ARRIVE sends the site and the device position', (tester) async {
      when(() => repo.arrive(siteId: any(named: 'siteId'), lat: any(named: 'lat'), lng: any(named: 'lng')))
          .thenAnswer((_) async => const ArrivalResult(visitId: 'V1', message: 'Arrival recorded', onSite: true, distanceFromSiteM: 3, travelKm: 0));
      await pump(tester);
      await tester.tap(find.text('ARRIVE'));
      await tester.pumpAndSettle();
      verify(() => repo.arrive(siteId: 'SITE-1', lat: 6.912, lng: 79.851)).called(1);
      await finish(tester);
    });

    testWidgets('ARRIVE without a location fix sends nothing and tells the officer why', (tester) async {
      await pump(tester, position: () async => null);
      await tester.tap(find.text('ARRIVE'));
      await tester.pumpAndSettle();
      verifyNever(() => repo.arrive(siteId: any(named: 'siteId'), lat: any(named: 'lat'), lng: any(named: 'lng')));
      expect(find.textContaining('location is needed'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('shows the server\'s refusal, for example when a visit is already open', (tester) async {
      when(() => repo.arrive(siteId: any(named: 'siteId'), lat: any(named: 'lat'), lng: any(named: 'lng')))
          .thenThrow(const ApiException('You already have a visit in progress. Depart from it first.', status: 409));
      await pump(tester);
      await tester.tap(find.text('ARRIVE'));
      await tester.pumpAndSettle();
      expect(find.textContaining('already have a visit in progress'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('an open visit shows DEPART, the site and an off-site warning', (tester) async {
      await pump(tester, state: VisitsState.fromJson({'open': _visit(onSite: false, distance: 410, travel: 2.5), 'today': [_visit()]}));
      expect(find.text('DEPART'), findsOneWidget);
      expect(find.text('ARRIVE'), findsNothing);
      expect(find.text('Cargills Main'), findsWidgets);
      // Status badges are rubber stamps, which always print in capitals.
      expect(find.textContaining('410 M FROM THE SITE'), findsOneWidget);
      expect(find.textContaining('2.5 km since your last visit'), findsOneWidget);
      await finish(tester);
    });

    testWidgets('DEPART sends the visit ID and the position', (tester) async {
      await pump(tester, state: VisitsState.fromJson({'open': _visit(), 'today': []}));
      await tester.tap(find.text('DEPART'));
      await tester.pumpAndSettle();
      verify(() => repo.depart('VISIT-1', lat: 6.912, lng: 79.851, notes: null)).called(1);
      await finish(tester);
    });

    testWidgets('DEPART still works without a location fix', (tester) async {
      await pump(tester, state: VisitsState.fromJson({'open': _visit(), 'today': []}), position: () async => null);
      await tester.tap(find.text('DEPART'));
      await tester.pumpAndSettle();
      verify(() => repo.depart('VISIT-1', lat: null, lng: null, notes: null)).called(1);
      await finish(tester);
    });

    testWidgets('lists today\'s visits with duration', (tester) async {
      await pump(tester, state: VisitsState.fromJson({'open': null, 'today': [_visit(id: 'V-A', open: false), _visit(id: 'V-B', open: false)]}));
      expect(find.text("Today's visits (2)"), findsOneWidget);
      expect(find.textContaining('20 min'), findsNWidgets(2));
      await finish(tester);
    });
  });
}
