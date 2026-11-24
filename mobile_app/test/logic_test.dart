import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:isoms_mobile/core/api_client.dart';
import 'package:isoms_mobile/core/models.dart';
import 'package:isoms_mobile/core/providers.dart';
import 'package:isoms_mobile/core/token_store.dart';
import 'package:isoms_mobile/features/login_screen.dart';
import 'package:isoms_mobile/features/report_forms.dart';

class _FakeTokenStore extends TokenStore {
  _FakeTokenStore([this.token]);
  String? token;

  @override
  Future<String?> read() async => token;
  @override
  Future<void> write(String t) async => token = t;
  @override
  Future<void> clear() async => token = null;
}

/// Returns a canned response (or throws) for every request, recording the last one.
class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.respond);
  final Future<ResponseBody> Function(RequestOptions) respond;
  RequestOptions? last;

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? body, Future<void>? cancel) {
    last = options;
    return respond(options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody _json(int status, Map<String, dynamic> body) => ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {Headers.contentTypeHeader: ['application/json']},
    );

ApiClient _client(_FakeAdapter adapter, {_FakeTokenStore? store, void Function()? onUnauthorized}) {
  final dio = Dio()..httpClientAdapter = adapter;
  return ApiClient(tokenStore: store ?? _FakeTokenStore(), onUnauthorized: onUnauthorized, dio: dio);
}

void main() {
  group('lateMinutes', () {
    test('same-day lateness', () {
      expect(lateMinutes(const TimeOfDay(hour: 6, minute: 0), const TimeOfDay(hour: 6, minute: 40)), 40);
    });

    test('wraps past midnight for night shifts', () {
      expect(lateMinutes(const TimeOfDay(hour: 22, minute: 0), const TimeOfDay(hour: 0, minute: 30)), 150);
    });

    test('exactly on time is zero', () {
      expect(lateMinutes(const TimeOfDay(hour: 6, minute: 0), const TimeOfDay(hour: 6, minute: 0)), 0);
    });

    test('arriving earlier than scheduled is rejected, not a ~24h delay', () {
      expect(lateMinutes(const TimeOfDay(hour: 6, minute: 0), const TimeOfDay(hour: 5, minute: 30)), isNull);
    });
  });

  group('models', () {
    test('Site parses counts that Postgres returns as strings', () {
      final site = Site.fromJson({
        'siteId': 'S1', 'name': 'Site', 'sector': 'Sec', 'region': 'Reg', 'location': 'Loc',
        'requiredOfficers': 10, 'currentOnDuty': '8', 'shortfall': '2', 'status': 'Alert',
      });

      expect(site.currentOnDuty, 8);
      expect(site.shortfall, 2);
      expect(site.hasShortfall, isTrue);
    });

    test('Site with no shortfall is not flagged', () {
      final site = Site.fromJson({'siteId': 'S', 'requiredOfficers': 5, 'currentOnDuty': '5', 'shortfall': '0'});
      expect(site.hasShortfall, isFalse);
    });

    test('AppUser initials and management flag', () {
      final gm = AppUser.fromJson({'epf': 'E1', 'name': 'Chamara Waduge', 'role': 'GM'});
      final vo = AppUser.fromJson({'epf': 'E2', 'name': 'Nuwan', 'role': 'VO'});

      expect(gm.initials, 'CW');
      expect(gm.isManagement, isTrue);
      expect(vo.initials, 'N');
      expect(vo.isManagement, isFalse);
    });

    test('AppUser with an empty name does not crash', () {
      expect(AppUser.fromJson({'epf': 'E', 'name': '  '}).initials, '?');
    });

    test('Attendance parses an open shift and history', () {
      final a = Attendance.fromJson({
        'activeShift': {'id': 7, 'siteId': 'S1', 'shift': 'Day', 'checkInTime': '2026-11-08T06:00:00.000Z'},
        'history': [
          {'id': 7, 'siteName': 'Site', 'shift': 'Day', 'checkInTime': '2026-11-08T06:00:00.000Z', 'checkOutTime': null, 'status': 'Checked In'},
        ],
      });

      expect(a.active?.id, 7);
      expect(a.history.single.checkOutTime, isNull);
    });

    test('Attendance with no open shift', () {
      expect(Attendance.fromJson({'activeShift': null, 'history': []}).active, isNull);
    });

    test('ExecutiveKpis parses trend and per-site breakdown', () {
      final k = ExecutiveKpis.fromJson({
        'totalRequired': 50, 'totalOnDuty': 43, 'totalShortfall': 7, 'totalAbsenceCount': 3, 'totalLateCount': 1,
        'absenteeismPercentage': 0.2, 'trend': 'Worsening (+0.13%)',
        'monthlyTrend': [{'month': 'Nov 2026', 'absenteeismPercentage': 0.2}],
        'siteBreakdown': [{'name': 'A', 'sector': 'S', 'currentAbsenceCount': 3, 'currentLateCount': 0, 'currentAbsenteeismPercentage': 1}],
      });

      expect(k.totalShortfall, 7);
      expect(k.monthly.single.percentage, 0.2);
      expect(k.sites.single.percentage, 1.0);
    });
  });

  group('ApiClient', () {
    test('sends the stored token as a Bearer header', () async {
      final adapter = _FakeAdapter((_) async => _json(200, {'ok': true}));
      await _client(adapter, store: _FakeTokenStore('abc123')).get('/sites');

      expect(adapter.last!.headers['Authorization'], 'Bearer abc123');
    });

    test('sends no Authorization header when signed out', () async {
      final adapter = _FakeAdapter((_) async => _json(200, {}));
      await _client(adapter).get('/sites');

      expect(adapter.last!.headers.containsKey('Authorization'), isFalse);
    });

    test('surfaces the server error message', () async {
      final adapter = _FakeAdapter((_) async => _json(400, {'error': 'Missing required payload fields: reason'}));

      await expectLater(
        _client(adapter).post('/absence/log', body: {}),
        throwsA(isA<ApiException>().having((e) => e.message, 'message', contains('Missing required'))),
      );
    });

    test('exposes the existing record on a 409 duplicate', () async {
      final adapter = _FakeAdapter((_) async => _json(409, {
            'error': 'This officer already has an absence logged for this date and shift',
            'existingRecord': {'logId': 'ABS-LOG-1', 'officerName': 'Guard A1'},
          }));

      try {
        await _client(adapter).post('/absence/log', body: {});
        fail('expected an ApiException');
      } on ApiException catch (e) {
        expect(e.isConflict, isTrue);
        expect(e.existingRecord?['logId'], 'ABS-LOG-1');
      }
    });

    test('a 401 on a normal call signals session expiry', () async {
      var expired = 0;
      final adapter = _FakeAdapter((_) async => _json(401, {'error': 'Invalid or expired session token'}));

      await expectLater(
        _client(adapter, onUnauthorized: () => expired++).get('/sites'),
        throwsA(isA<ApiException>().having((e) => e.isUnauthorized, 'isUnauthorized', isTrue)),
      );
      expect(expired, 1);
    });

    test('a 401 from the login call is a bad password, NOT a session expiry', () async {
      var expired = 0;
      final adapter = _FakeAdapter((_) async => _json(401, {'error': 'Invalid EPF Staff ID or credentials'}));

      await expectLater(
        _client(adapter, onUnauthorized: () => expired++).post('/auth/login', body: {}),
        throwsA(isA<ApiException>()),
      );
      expect(expired, 0);
    });

    test('a network failure becomes a readable message', () async {
      final adapter = _FakeAdapter((o) async => throw DioException.connectionError(requestOptions: o, reason: 'down'));

      await expectLater(
        _client(adapter).get('/sites'),
        throwsA(isA<ApiException>().having((e) => e.message, 'message', contains('Cannot reach'))),
      );
    });

    test('a 500 without a body still gives a message with the status', () async {
      final adapter = _FakeAdapter((_) async => ResponseBody.fromString('oops', 500));

      await expectLater(
        _client(adapter).get('/kpis/executive'),
        throwsA(isA<ApiException>().having((e) => e.message, 'message', contains('500'))),
      );
    });
  });

  group('LoginScreen', () {
    Widget app(TokenStore store) => ProviderScope(
          overrides: [tokenStoreProvider.overrideWithValue(store)],
          child: const MaterialApp(home: LoginScreen()),
        );

    testWidgets('requires both fields before calling the server', (tester) async {
      await tester.pumpWidget(app(_FakeTokenStore()));
      await tester.tap(find.text('SIGN IN'));
      await tester.pump();

      expect(find.text('Required'), findsNWidgets(2));
    });

    testWidgets('passcode is hidden until the user reveals it', (tester) async {
      await tester.pumpWidget(app(_FakeTokenStore()));

      EditableText field() => tester.widget<EditableText>(find.byType(EditableText).last);
      expect(field().obscureText, isTrue);

      await tester.tap(find.byTooltip('Show passcode'));
      await tester.pump();
      expect(field().obscureText, isFalse);
    });

    testWidgets('does not display any demo credentials', (tester) async {
      await tester.pumpWidget(app(_FakeTokenStore()));

      expect(find.textContaining('passcode123'), findsNothing);
    });
  });
}
