import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api_client.dart';
import 'models.dart';
import 'repository.dart';
import 'token_store.dart';

final tokenStoreProvider = Provider<TokenStore>((ref) => TokenStore());

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(
    tokenStore: ref.watch(tokenStoreProvider),
    // The server rejected our token (expired / account removed): drop to the login screen.
    onUnauthorized: () => ref.read(authControllerProvider.notifier).sessionExpired(),
  );
});

final repositoryProvider = Provider<IsomsRepository>(
  (ref) => IsomsRepository(ref.watch(apiClientProvider)),
);

/// The signed-in user, or null when signed out. Restores a stored session on startup.
class AuthController extends AsyncNotifier<AppUser?> {
  @override
  Future<AppUser?> build() async {
    final store = ref.read(tokenStoreProvider);
    if (await store.read() == null) return null;

    try {
      return await ref.read(repositoryProvider).currentUser();
    } on ApiException catch (e) {
      if (e.isUnauthorized) await store.clear();
      return null; // offline at launch or stale token: show the login screen
    }
  }

  /// Throws [ApiException] on bad credentials so the login form can show the message.
  Future<void> login(String epf, String password) async {
    final result = await ref.read(repositoryProvider).login(epf, password);
    await ref.read(tokenStoreProvider).write(result.token);
    state = AsyncData(result.user);
  }

  /// Throws [ApiException] (wrong current passcode, weak new one) for the form to display.
  Future<void> changePassword(String current, String next) async {
    final result = await ref.read(repositoryProvider).changePassword(current, next);
    await ref.read(tokenStoreProvider).write(result.token);
    state = AsyncData(result.user);
  }

  Future<void> logout() async {
    await ref.read(tokenStoreProvider).clear();
    state = const AsyncData(null);
  }

  void sessionExpired() {
    if (state.value == null) return;
    ref.read(tokenStoreProvider).clear();
    state = const AsyncData(null);
  }
}

final authControllerProvider =
    AsyncNotifierProvider<AuthController, AppUser?>(AuthController.new);

// ── Server data. autoDispose so each screen refetches fresh data when reopened ──

final sitesProvider = FutureProvider.autoDispose<List<Site>>(
  (ref) => ref.watch(repositoryProvider).sites(),
);

final officersProvider = FutureProvider.autoDispose<List<Officer>>(
  (ref) => ref.watch(repositoryProvider).officers(),
);

final visitsProvider = FutureProvider.autoDispose<VisitsState>(
  (ref) => ref.watch(repositoryProvider).myVisits(),
);

final opsBoardProvider = FutureProvider.autoDispose<OpsBoard>(
  (ref) => ref.watch(repositoryProvider).opsBoard(),
);

final kpisProvider = FutureProvider.autoDispose<ExecutiveKpis>(
  (ref) => ref.watch(repositoryProvider).kpis(),
);

final attendanceProvider = FutureProvider.autoDispose<Attendance>(
  (ref) => ref.watch(repositoryProvider).attendance(),
);

final auditLogProvider = FutureProvider.autoDispose.family<List<AuditRecord>, RecordKind>(
  (ref, kind) => ref.watch(repositoryProvider).auditLog(kind),
);
