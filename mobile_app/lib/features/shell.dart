import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/providers.dart';
import '../core/theme.dart';

/// Bottom-tab frame for the four main areas. Each tab keeps its own scroll/state.
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.shell});

  final StatefulNavigationShell shell;

  static const _titles = ['My Sites', 'Shift Check-In', 'Report', 'Activity Log', 'Operations', 'Site Visits'];

  static const _destinations = [
    NavigationDestination(icon: Icon(Icons.apartment_outlined), selectedIcon: Icon(Icons.apartment_rounded), label: 'Sites'),
    NavigationDestination(icon: Icon(Icons.how_to_reg_outlined), selectedIcon: Icon(Icons.how_to_reg_rounded), label: 'Check-In'),
    NavigationDestination(icon: Icon(Icons.edit_note_outlined), selectedIcon: Icon(Icons.edit_note_rounded), label: 'Report'),
    NavigationDestination(icon: Icon(Icons.history_outlined), selectedIcon: Icon(Icons.history_rounded), label: 'Activity'),
    NavigationDestination(icon: Icon(Icons.radar_outlined), selectedIcon: Icon(Icons.radar_rounded), label: 'Ops'),
    NavigationDestination(icon: Icon(Icons.alt_route_outlined), selectedIcon: Icon(Icons.alt_route_rounded), label: 'Visits'),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).value;
    // Branch indexes shown for this role: a guard only has Check-In and Report.
    final branches = user?.isGuard == true
        ? const [1, 2]
        : user?.isControlRoom == true
            ? const [4, 0, 1, 2, 3]
            : user?.canVisit == true
                ? const [0, 5, 1, 2, 3]
                : const [0, 1, 2, 3];

    return Scaffold(
      appBar: AppBar(
        title: Text(_titles[shell.currentIndex], style: const TextStyle(fontWeight: FontWeight.w800)),
        actions: [
          if (user != null)
            PopupMenuButton<String>(
              tooltip: 'Account',
              offset: const Offset(0, 48),
              color: Brand.surfaceElevated,
              onSelected: (v) async {
                if (v == 'passcode') context.push('/change-passcode');
                if (v == 'logout') await ref.read(authControllerProvider.notifier).logout();
              },
              itemBuilder: (_) => [
                PopupMenuItem<String>(
                  enabled: false,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(user.name, style: const TextStyle(color: Brand.text, fontWeight: FontWeight.w700)),
                      Text(user.title, style: const TextStyle(color: Brand.textMuted, fontSize: 12)),
                      Text('${user.epf} · ${user.role}', style: const TextStyle(color: Brand.textDim, fontSize: 11)),
                    ],
                  ),
                ),
                const PopupMenuDivider(),
                const PopupMenuItem<String>(
                  value: 'passcode',
                  child: Row(children: [Icon(Icons.key_rounded, size: 18), SizedBox(width: 10), Text('Change passcode')]),
                ),
                const PopupMenuItem<String>(
                  value: 'logout',
                  child: Row(children: [Icon(Icons.logout_rounded, size: 18), SizedBox(width: 10), Text('Sign out')]),
                ),
              ],
              child: Padding(
                padding: const EdgeInsets.only(right: 16),
                child: CircleAvatar(
                  radius: 17,
                  backgroundColor: Brand.brass,
                  child: Text(user.initials, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: Color(0xFF2A1206))),
                ),
              ),
            ),
        ],
      ),
      body: shell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: branches.contains(shell.currentIndex) ? branches.indexOf(shell.currentIndex) : 0,
        onDestinationSelected: (i) => shell.goBranch(branches[i], initialLocation: branches[i] == shell.currentIndex),
        destinations: [for (final b in branches) _destinations[b]],
      ),
    );
  }
}
