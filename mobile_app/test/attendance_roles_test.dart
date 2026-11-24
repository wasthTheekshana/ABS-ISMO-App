import 'package:flutter_test/flutter_test.dart';
import 'package:isoms_mobile/core/models.dart';

AppUser _user(String role) => AppUser.fromJson({
      'epf': 'E1',
      'name': 'Test',
      'role': role,
      'title': 't',
      'region': 'r',
      'sector': 's',
    });

void main() {
  group('role capabilities (SRS FR-15, FR-20)', () {
    test('only VO, NVO and SM may perform inspections', () {
      for (final role in ['VO', 'NVO', 'SM']) {
        expect(_user(role).canInspect, isTrue, reason: role);
      }
      for (final role in ['MD', 'GM', 'AGM', 'CONTROL_ROOM', 'SECURITY_GUARD', 'CLIENT']) {
        expect(_user(role).canInspect, isFalse, reason: role);
      }
    });

    test('guards and staff may report incidents, clients may not', () {
      for (final role in ['MD', 'GM', 'AGM', 'SM', 'VO', 'NVO', 'CONTROL_ROOM', 'SECURITY_GUARD']) {
        expect(_user(role).canReportIncident, isTrue, reason: role);
      }
      expect(_user('CLIENT').canReportIncident, isFalse);
    });

    test('a guard can log neither absence nor late reports', () {
      expect(_user('SECURITY_GUARD').canLogAttendance, isFalse);
    });

    test('isGuard and isClient identify only their own role', () {
      expect(_user('SECURITY_GUARD').isGuard, isTrue);
      expect(_user('SECURITY_GUARD').isClient, isFalse);
      expect(_user('CLIENT').isClient, isTrue);
      expect(_user('CLIENT').isGuard, isFalse);
      expect(_user('VO').isGuard, isFalse);
      expect(_user('VO').isClient, isFalse);
    });
  });

  group('canLogAttendance (SRS FR-4, FR-5)', () {
    for (final role in ['VO', 'NVO', 'SM', 'CONTROL_ROOM']) {
      test('$role may log absence and late reports', () {
        expect(_user(role).canLogAttendance, isTrue);
      });
    }
    for (final role in ['MD', 'GM', 'AGM', 'SECURITY_GUARD', '']) {
      test('"$role" may not', () {
        expect(_user(role).canLogAttendance, isFalse);
      });
    }
  });
}
