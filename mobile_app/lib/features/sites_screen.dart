import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../common/widgets.dart';
import '../core/models.dart';
import '../core/providers.dart';
import '../core/theme.dart';

class SitesScreen extends ConsumerWidget {
  const SitesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).value;
    final sites = ref.watch(sitesProvider);

    Future<void> refresh() async {
      ref.invalidate(kpisProvider);
      ref.invalidate(sitesProvider);
      await ref.read(sitesProvider.future).catchError((_) => <Site>[]);
    }

    return RefreshIndicator(
      onRefresh: refresh,
      child: AsyncBody<List<Site>>(
        value: sites,
        onRetry: refresh,
        builder: (list) => ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
          children: [
            if (user?.isManagement ?? false) const _KpiStrip(),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('${list.length} ${list.length == 1 ? 'site' : 'sites'}',
                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                  const Text('Live duty roster', style: TextStyle(color: Brand.textMuted, fontSize: 12)),
                ],
              ),
            ),
            if (list.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 48),
                child: EmptyState(icon: Icons.apartment_outlined, message: 'No security sites are assigned to your scope.'),
              ),
            for (final site in list) Padding(padding: const EdgeInsets.only(bottom: 12), child: _SiteCard(site: site)),
          ],
        ),
      ),
    );
  }
}

class _SiteCard extends StatelessWidget {
  const _SiteCard({required this.site});

  final Site site;

  @override
  Widget build(BuildContext context) {
    final alert = site.hasShortfall;
    final ratio = site.requiredOfficers == 0 ? 1.0 : (site.currentOnDuty / site.requiredOfficers).clamp(0.0, 1.0);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(site.name, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                      const SizedBox(height: 2),
                      Text('${site.location} · ${site.siteId}',
                          style: const TextStyle(color: Brand.textMuted, fontSize: 12)),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                alert
                    ? StatusBadge('${site.shortfall} short', color: Brand.danger, icon: Icons.warning_amber_rounded)
                    : const StatusBadge('Optimal', color: Brand.success, icon: Icons.check_circle_outline_rounded),
              ],
            ),
            const SizedBox(height: 14),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(
                value: ratio,
                minHeight: 8,
                backgroundColor: Brand.surfaceElevated,
                color: alert ? Brand.gold : Brand.success,
              ),
            ),
            const SizedBox(height: 10),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('${site.currentOnDuty} on duty of ${site.requiredOfficers} required',
                    style: const TextStyle(color: Brand.textMuted, fontSize: 12)),
                Text(site.sector, style: const TextStyle(color: Brand.textDim, fontSize: 11)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Headline KPIs for management roles (same server-scoped numbers as the web dashboard).
class _KpiStrip extends ConsumerWidget {
  const _KpiStrip();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final kpis = ref.watch(kpisProvider);

    return kpis.when(
      skipLoadingOnRefresh: true,
      loading: () => const SizedBox(height: 96, child: Center(child: CircularProgressIndicator())),
      error: (e, _) => Padding(padding: const EdgeInsets.only(top: 8), child: ErrorBanner('$e')),
      data: (k) => Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Column(
          children: [
            GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              childAspectRatio: 1.9,
              mainAxisSpacing: 10,
              crossAxisSpacing: 10,
              children: [
                _Kpi('On duty', '${k.totalOnDuty}', 'of ${k.totalRequired} required', Brand.success),
                _Kpi('Shortfall', '${k.totalShortfall}', 'officers short', k.totalShortfall > 0 ? Brand.danger : Brand.success),
                _Kpi('Absenteeism', '${k.absenteeism}%', k.trend, Brand.gold),
                _Kpi('Late reports', '${k.totalLate}', '${k.totalAbsence} absences logged', Brand.primary),
              ],
            ),
            if (k.monthly.length >= 2) ...[
              const SizedBox(height: 10),
              TrendCard(points: k.monthly),
            ],
          ],
        ),
      ),
    );
  }
}

/// Monthly absenteeism trend, scoped by the server to the caller's role.
class TrendCard extends StatelessWidget {
  const TrendCard({super.key, required this.points});

  final List<MonthPoint> points;

  @override
  Widget build(BuildContext context) {
    final maxY = points.map((p) => p.percentage).reduce((a, b) => a > b ? a : b);
    final ceiling = maxY <= 0 ? 1.0 : maxY * 1.3;

    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 14, 16, 8),
        child: Semantics(
          excludeSemantics: true,
          label: 'Monthly absenteeism trend over the last ${points.length} months: '
              '${points.map((p) => '${p.month} ${p.percentage}%').join(', ')}',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Padding(
                padding: EdgeInsets.only(left: 4, bottom: 12),
                child: Text('MONTHLY ABSENTEEISM %',
                    style: TextStyle(color: Brand.textMuted, fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 0.7)),
              ),
              SizedBox(
                height: 150,
                child: LineChart(
                  LineChartData(
                    minY: 0,
                    maxY: ceiling,
                    gridData: const FlGridData(show: true, drawVerticalLine: false),
                    borderData: FlBorderData(show: false),
                    titlesData: FlTitlesData(
                      topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                      rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                      leftTitles: AxisTitles(
                        sideTitles: SideTitles(
                          showTitles: true,
                          reservedSize: 34,
                          getTitlesWidget: (v, meta) => v == meta.max
                              ? const SizedBox.shrink()
                              : Text(v.toStringAsFixed(1),
                                  style: const TextStyle(color: Brand.textDim, fontSize: 10)),
                        ),
                      ),
                      bottomTitles: AxisTitles(
                        sideTitles: SideTitles(
                          showTitles: true,
                          interval: 1,
                          reservedSize: 22,
                          getTitlesWidget: (v, meta) {
                            final i = v.toInt();
                            if (v != i.toDouble() || i < 0 || i >= points.length) return const SizedBox.shrink();
                            final label = points[i].month;
                            return Padding(
                              padding: const EdgeInsets.only(top: 6),
                              child: Text(label.length > 3 ? label.substring(0, 3) : label,
                                  style: const TextStyle(color: Brand.textDim, fontSize: 10)),
                            );
                          },
                        ),
                      ),
                    ),
                    lineBarsData: [
                      LineChartBarData(
                        spots: [for (var i = 0; i < points.length; i++) FlSpot(i.toDouble(), points[i].percentage)],
                        isCurved: true,
                        preventCurveOverShooting: true,
                        color: Brand.gold,
                        barWidth: 3,
                        dotData: const FlDotData(show: true),
                        belowBarData: BarAreaData(show: true, color: Brand.gold.withValues(alpha: 0.14)),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Kpi extends StatelessWidget {
  const _Kpi(this.label, this.value, this.caption, this.color);

  final String label, value, caption;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(label.toUpperCase(),
                style: const TextStyle(color: Brand.textMuted, fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 0.7)),
            const SizedBox(height: 2),
            Text(value, style: Brand.numeral(size: 34, color: color)),
            Text(caption, maxLines: 1, overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: Brand.textDim, fontSize: 10)),
          ],
        ),
      ),
    );
  }
}
