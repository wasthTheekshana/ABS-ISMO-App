import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/offline_queue.dart';
import '../core/theme.dart';
import '../core/visit_tracker.dart';
import 'router.dart';

class IsomsApp extends ConsumerWidget {
  const IsomsApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Keeps the offline report queue alive (and retrying) for the whole signed-in session.
    ref.watch(pendingReportsProvider);
    // Keeps location pings going while a Visiting Officer has a site visit open, on any tab.
    ref.watch(visitTrackerProvider);

    return MaterialApp.router(
      title: 'AB Securitas ISOMS',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      themeMode: ThemeMode.light,
      routerConfig: ref.watch(routerProvider),
    );
  }
}
