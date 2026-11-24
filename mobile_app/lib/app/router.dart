import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../features/client_notice_screen.dart';
import '../features/ops_screen.dart';
import '../features/visits_screen.dart';

import '../core/models.dart';
import '../core/providers.dart';
import '../features/activity_screen.dart';
import '../features/attendance_screen.dart';
import '../features/change_passcode_screen.dart';
import '../features/confirmation_screen.dart';
import '../features/login_screen.dart';
import '../features/report_forms.dart';
import '../features/report_hub_screen.dart';
import '../features/shell.dart';
import '../features/sites_screen.dart';

const _publicRoutes = {'/login', '/splash'};

/// Routing is driven by auth state: signed-out users can only see /login; signed-in users
/// are bounced away from it. The redirect re-runs whenever auth changes.
final routerProvider = Provider<GoRouter>((ref) {
  final auth = ValueNotifier<AsyncValue<AppUser?>>(ref.read(authControllerProvider));
  ref.listen(authControllerProvider, (_, next) => auth.value = next);
  ref.onDispose(auth.dispose);
  var controlRoomLanded = false; // lands on /ops once per signed-in session

  return GoRouter(
    initialLocation: '/sites',
    refreshListenable: auth,
    redirect: (context, state) {
      final value = auth.value;
      final location = state.matchedLocation;

      if (value.isLoading && !value.hasValue) return location == '/splash' ? null : '/splash';

      final user = value.value;
      if (user == null) {
        controlRoomLanded = false;
        return location == '/login' ? null : '/login';
      }

      // Still on the shared initial passcode: nothing else is reachable until it is changed.
      if (user.mustChangePassword) return location == '/change-passcode' ? null : '/change-passcode';

      // Control Room starts each session on the Operations tab, but can still visit the others.
      if (user.isControlRoom && !controlRoomLanded) {
        controlRoomLanded = true;
        if (location == '/sites' || _publicRoutes.contains(location)) return '/ops';
      }

      // Clients have no phone experience yet; they use the web portal.
      if (user.isClient) return location == '/client-notice' ? null : '/client-notice';
      // A guard has no Sites or Activity tab: land on check-in instead.
      if (user.isGuard && (location == '/sites' || location == '/activity' || _publicRoutes.contains(location))) {
        return '/attendance';
      }

      if (_publicRoutes.contains(location)) return '/sites';
      return null;
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => const _SplashScreen()),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/change-passcode', builder: (_, _) => const ChangePasscodeScreen()),
      GoRoute(path: '/client-notice', builder: (_, _) => const ClientNoticeScreen()),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => AppShell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [
            GoRoute(path: '/sites', builder: (_, _) => const SitesScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/attendance', builder: (_, _) => const AttendanceScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/report', builder: (_, _) => const ReportHubScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/activity', builder: (_, _) => const ActivityScreen()),
          ]),
          // Branch 4: Control Room only (the shell hides this tab for every other role).
          StatefulShellBranch(routes: [
            GoRoute(path: '/ops', builder: (_, _) => const OpsScreen()),
          ]),
          // Branch 5: Visiting Officers only (site rounds, FR-14).
          StatefulShellBranch(routes: [
            GoRoute(path: '/visits', builder: (_, _) => const VisitsScreen()),
          ]),
        ],
      ),
      // Full-screen flows pushed above the tab bar.
      GoRoute(path: '/report/absence', builder: (_, _) => const AbsenceFormScreen()),
      GoRoute(path: '/report/late', builder: (_, _) => const LateFormScreen()),
      GoRoute(path: '/report/incident', builder: (_, _) => const IncidentFormScreen()),
      GoRoute(path: '/report/inspection', builder: (_, _) => const InspectionFormScreen()),
      GoRoute(
        path: '/confirmation',
        builder: (_, state) => ConfirmationScreen(
          recordId: state.uri.queryParameters['id'] ?? '',
          label: state.uri.queryParameters['type'] ?? 'Report',
          queued: state.uri.queryParameters['queued'] == '1',
        ),
      ),
    ],
  );
});

class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) =>
      const Scaffold(body: Center(child: CircularProgressIndicator()));
}
