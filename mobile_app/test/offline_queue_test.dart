import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:isoms_mobile/core/api_client.dart';
import 'package:isoms_mobile/core/models.dart';
import 'package:isoms_mobile/core/offline_queue.dart';
import 'package:isoms_mobile/core/providers.dart';
import 'package:isoms_mobile/core/repository.dart';
import 'package:isoms_mobile/features/change_passcode_screen.dart';
import 'package:isoms_mobile/features/sites_screen.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _MockRepo extends Mock implements IsomsRepository {}

class _FakeAuth extends AuthController {
  _FakeAuth(this.epf, {this.mustChange = false});
  final String? epf;
  final bool mustChange;

  @override
  Future<AppUser?> build() async => epf == null
      ? null
      : AppUser(
          epf: epf!,
          name: 'Test Officer',
          role: 'VO',
          title: 'Visiting Officer',
          region: 'R',
          sector: 'S',
          mustChangePassword: mustChange,
        );
}

const _offline = ApiException('Cannot reach the ISOMS server. Check your network connection.');

Future<void> _settle() async {
  for (var i = 0; i < 6; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

void main() {
  late _MockRepo repo;
  final containers = <ProviderContainer>[];

  setUpAll(() => registerFallbackValue(RecordKind.absence));

  setUp(() {
    repo = _MockRepo();
    SharedPreferences.setMockInitialValues({});
  });

  tearDown(() {
    for (final c in containers) {
      c.dispose();
    }
    containers.clear();
  });

  Future<ProviderContainer> signedIn({String? epf = 'EPF-1'}) async {
    final container = ProviderContainer(overrides: [
      authControllerProvider.overrideWith(() => _FakeAuth(epf)),
      repositoryProvider.overrideWithValue(repo),
    ]);
    containers.add(container);
    await container.read(authControllerProvider.future);
    container.listen(pendingReportsProvider, (_, _) {});
    await _settle();
    return container;
  }

  group('offline report queue', () {
    test('a queued report is sent on flush and removed', () async {
      when(() => repo.submit(any(), any())).thenAnswer((_) async => 'ABS-LOG-1');
      final c = await signedIn();
      final queue = c.read(pendingReportsProvider.notifier);

      await queue.enqueue(RecordKind.absence, {'epf': 'E1', 'siteId': 'S1'});
      expect(c.read(pendingReportsProvider).queued, hasLength(1));

      await queue.flush();

      expect(c.read(pendingReportsProvider).queued, isEmpty);
      verify(() => repo.submit(RecordKind.absence, {'epf': 'E1', 'siteId': 'S1'})).called(1);
    });

    test('while offline the report stays queued, in order, and nothing is lost', () async {
      when(() => repo.submit(any(), any())).thenThrow(_offline);
      final c = await signedIn();
      final queue = c.read(pendingReportsProvider.notifier);

      await queue.enqueue(RecordKind.absence, {'n': 1});
      await queue.enqueue(RecordKind.late, {'n': 2});
      await queue.flush();

      final state = c.read(pendingReportsProvider);
      expect(state.queued.map((r) => r.payload['n']), [1, 2]);
      expect(state.rejected, isEmpty);
      expect(state.syncing, isFalse);
      // Stops at the first network failure instead of hammering the server per report.
      verify(() => repo.submit(any(), any())).called(1);
    });

    test('a server refusal moves the report to rejected and is not retried', () async {
      when(() => repo.submit(any(), any())).thenThrow(const ApiException('Invalid severity', status: 400));
      final c = await signedIn();
      final queue = c.read(pendingReportsProvider.notifier);

      await queue.enqueue(RecordKind.incident, {'severity': 'Huge'});
      await queue.flush();
      await queue.flush();

      final state = c.read(pendingReportsProvider);
      expect(state.queued, isEmpty);
      expect(state.rejected.single.rejection, 'Invalid severity');
      verify(() => repo.submit(any(), any())).called(1);
    });

    test('a 409 duplicate is dropped quietly because the server already has it', () async {
      when(() => repo.submit(any(), any())).thenThrow(const ApiException('Already logged', status: 409));
      final c = await signedIn();
      final queue = c.read(pendingReportsProvider.notifier);

      await queue.enqueue(RecordKind.absence, {'epf': 'E1'});
      await queue.flush();

      final state = c.read(pendingReportsProvider);
      expect(state.queued, isEmpty);
      expect(state.rejected, isEmpty);
    });

    test('reports survive an app restart', () async {
      when(() => repo.submit(any(), any())).thenThrow(_offline);
      final first = await signedIn();
      await first.read(pendingReportsProvider.notifier).enqueue(RecordKind.late, {'epf': 'E9'});
      first.dispose();
      containers.remove(first);

      final second = await signedIn();
      await _settle();

      final queued = second.read(pendingReportsProvider).queued;
      expect(queued.single.kind, RecordKind.late);
      expect(queued.single.payload, {'epf': 'E9'});
    });

    test("another user's reports are never loaded or sent", () async {
      when(() => repo.submit(any(), any())).thenThrow(_offline);
      final alice = await signedIn(epf: 'EPF-ALICE');
      await alice.read(pendingReportsProvider.notifier).enqueue(RecordKind.absence, {'who': 'alice'});

      final bob = await signedIn(epf: 'EPF-BOB');
      await _settle();

      expect(bob.read(pendingReportsProvider).queued, isEmpty);
    });

    test('a signed-out session has an empty queue', () async {
      final c = await signedIn(epf: null);
      expect(c.read(pendingReportsProvider).queued, isEmpty);
    });

    test('a refused report can be dismissed', () async {
      when(() => repo.submit(any(), any())).thenThrow(const ApiException('Bad', status: 400));
      final c = await signedIn();
      final queue = c.read(pendingReportsProvider.notifier);
      await queue.enqueue(RecordKind.absence, {'x': 1});
      await queue.flush();

      await queue.dismissRejected(c.read(pendingReportsProvider).rejected.single);

      expect(c.read(pendingReportsProvider).rejected, isEmpty);
    });

    test('only "could not reach the server" counts as a network failure', () {
      expect(isNetworkFailure(_offline), isTrue);
      expect(isNetworkFailure(const ApiException('nope', status: 400)), isFalse);
      expect(isNetworkFailure(const ApiException('nope', status: 500)), isFalse);
      expect(isNetworkFailure(StateError('x')), isFalse);
    });
  });

  group('ChangePasscodeScreen', () {
    Future<void> open(WidgetTester tester, {required bool forced}) async {
      await tester.pumpWidget(ProviderScope(
        overrides: [authControllerProvider.overrideWith(() => _FakeAuth('EPF-1', mustChange: forced))],
        child: const MaterialApp(home: ChangePasscodeScreen()),
      ));
      await tester.pumpAndSettle();
    }

    testWidgets('first-login mode explains why and offers sign out instead of back', (tester) async {
      await open(tester, forced: true);

      expect(find.text('Choose your passcode'), findsOneWidget);
      expect(find.textContaining('shared initial passcode'), findsOneWidget);
      expect(find.text('SIGN OUT'), findsOneWidget);
      expect(find.byType(BackButton), findsNothing);
    });

    testWidgets('voluntary mode has no sign-out nag', (tester) async {
      await open(tester, forced: false);

      expect(find.text('Change passcode'), findsOneWidget);
      expect(find.text('SIGN OUT'), findsNothing);
    });

    testWidgets('validates before calling the server', (tester) async {
      await open(tester, forced: true);
      final fields = find.byType(TextFormField);

      await tester.enterText(fields.at(0), 'old');
      await tester.enterText(fields.at(1), 'short1');
      await tester.enterText(fields.at(2), 'different1');
      await tester.tap(find.text('SAVE NEW PASSCODE'));
      await tester.pump();

      expect(find.text('At least 8 characters'), findsOneWidget);
      expect(find.text('Does not match the new passcode'), findsOneWidget);
    });

    testWidgets('requires letters and numbers', (tester) async {
      await open(tester, forced: true);
      final fields = find.byType(TextFormField);

      await tester.enterText(fields.at(0), 'old');
      await tester.enterText(fields.at(1), 'onlyletters');
      await tester.enterText(fields.at(2), 'onlyletters');
      await tester.tap(find.text('SAVE NEW PASSCODE'));
      await tester.pump();

      expect(find.text('Use letters and numbers'), findsOneWidget);
    });

    testWidgets('passcodes are hidden until the user reveals them', (tester) async {
      await open(tester, forced: true);
      EditableText first() => tester.widget<EditableText>(find.byType(EditableText).first);

      expect(first().obscureText, isTrue);
      await tester.tap(find.text('Show passcodes'));
      await tester.pump();
      expect(first().obscureText, isFalse);
    });
  });

  test('AppUser reads the must-change flag and defaults to false', () {
    expect(AppUser.fromJson({'epf': 'E', 'mustChangePassword': true}).mustChangePassword, isTrue);
    expect(AppUser.fromJson({'epf': 'E'}).mustChangePassword, isFalse);
  });

  group('TrendCard', () {
    testWidgets('draws a line chart with an accessible description', (tester) async {
      final semantics = tester.ensureSemantics();
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: TrendCard(points: const [MonthPoint('Sep 2026', 0.1), MonthPoint('Oct 2026', 0.4), MonthPoint('Nov 2026', 0.2)]),
        ),
      ));

      expect(find.byType(LineChart), findsOneWidget);
      expect(
        find.bySemanticsLabel(RegExp(r'^Monthly absenteeism trend over the last 3 months: Sep 2026 0\.1%, Oct 2026 0\.4%, Nov 2026 0\.2%$')),
        findsOneWidget,
      );
      semantics.dispose();
    });

    testWidgets('does not crash when every month is zero', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(body: TrendCard(points: const [MonthPoint('Oct 2026', 0), MonthPoint('Nov 2026', 0)])),
      ));

      expect(tester.takeException(), isNull);
      expect(find.byType(LineChart), findsOneWidget);
    });
  });
}
