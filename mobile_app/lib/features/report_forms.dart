import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';

import '../common/widgets.dart';
import '../core/api_client.dart';
import '../core/location_service.dart';
import '../core/models.dart';
import '../core/offline_queue.dart';
import '../core/providers.dart';
import '../core/theme.dart';

// ── Shared scaffolding ────────────────────────────────────────────────────────

/// Common frame for every report form: app bar, scrolling body, error banner and a
/// submit button that disables itself while the request is in flight.
class _FormFrame extends StatelessWidget {
  const _FormFrame({
    required this.title,
    required this.formKey,
    required this.submitLabel,
    required this.busy,
    required this.onSubmit,
    required this.children,
    this.error,
    this.accent = Brand.primary,
  });

  final String title, submitLabel;
  final GlobalKey<FormState> formKey;
  final bool busy;
  final VoidCallback onSubmit;
  final List<Widget> children;
  final String? error;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title, style: const TextStyle(fontWeight: FontWeight.w800))),
      body: SafeArea(
        child: Form(
          key: formKey,
          child: ListView(
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
            children: [
              ...children,
              if (error != null) ...[ErrorBanner(error!), const SizedBox(height: 12)],
              FilledButton(
                onPressed: busy ? null : onSubmit,
                style: FilledButton.styleFrom(backgroundColor: accent, foregroundColor: Colors.white),
                child: busy
                    ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                    : Text(submitLabel),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Submission state shared by all forms.
mixin _Submitter<T extends ConsumerStatefulWidget> on ConsumerState<T> {
  final formKey = GlobalKey<FormState>();
  bool busy = false;
  String? error;
  Map<String, dynamic>? existingRecord;

  /// Validates, sends, and on success navigates to the confirmation screen using the
  /// ID the SERVER issued. A server refusal stays on the form with the real error message.
  /// If the server cannot be reached at all, the report is saved on the phone and sent
  /// automatically later (see offline_queue.dart) so a field officer never loses it.
  Future<void> submit(RecordKind kind, Map<String, dynamic> Function() build, String label) async {
    if (!formKey.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    setState(() {
      busy = true;
      error = null;
      existingRecord = null;
    });

    final label0 = Uri.encodeQueryComponent(label);
    Map<String, dynamic>? payload;
    try {
      payload = build();
      final id = await ref.read(repositoryProvider).submit(kind, payload);
      if (!mounted) return;
      ref.invalidate(auditLogProvider);
      ref.invalidate(sitesProvider);
      ref.invalidate(kpisProvider);
      context.pushReplacement('/confirmation?id=${Uri.encodeQueryComponent(id)}&type=$label0');
    } on ApiException catch (e) {
      if (!mounted) return;
      if (isNetworkFailure(e) && payload != null) {
        await ref.read(pendingReportsProvider.notifier).enqueue(kind, payload);
        if (!mounted) return;
        context.pushReplacement('/confirmation?id=&type=$label0&queued=1');
        return;
      }
      setState(() {
        error = e.message;
        existingRecord = e.isConflict ? e.existingRecord : null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => error = 'Something went wrong. Please try again.');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }
}

String _today() => DateFormat('yyyy-MM-dd').format(DateTime.now());

/// Site + (optionally) officer selection, which every attendance-type report needs.
class _SiteField extends ConsumerWidget {
  const _SiteField({required this.value, required this.onChanged});

  final String? value;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sites = ref.watch(sitesProvider);
    return sites.when(
      loading: () => const LinearProgressIndicator(),
      error: (e, _) => ErrorBanner('$e'),
      data: (list) => PickerField<String>(
        label: 'Site',
        value: value,
        items: [for (final s in list) s.siteId],
        labelOf: (id) => list.firstWhere((s) => s.siteId == id).name,
        onChanged: onChanged,
        validator: requiredField,
      ),
    );
  }
}

class _OfficerField extends ConsumerWidget {
  const _OfficerField({required this.label, required this.siteId, required this.value, required this.onChanged, this.excludeEpf});

  final String label;
  final String? siteId, excludeEpf, value;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final officers = ref.watch(officersProvider).value ?? const <Officer>[];
    final atSite = [for (final o in officers) if (o.siteId == siteId && o.epf != excludeEpf) o];

    return PickerField<String>(
      label: atSite.isEmpty && siteId != null ? '$label (none assigned to this site)' : label,
      value: value,
      items: [for (final o in atSite) o.epf],
      labelOf: (epf) {
        final o = atSite.firstWhere((o) => o.epf == epf);
        return '${o.name} (${o.epf})';
      },
      onChanged: atSite.isEmpty ? null : onChanged,
      validator: requiredField,
    );
  }
}

class _ExistingRecordCard extends StatelessWidget {
  const _ExistingRecordCard(this.record);

  final Map<String, dynamic> record;

  @override
  Widget build(BuildContext context) {
    String f(String k) => '${record[k] ?? '—'}';
    return Card(
      color: Brand.gold.withValues(alpha: 0.08),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: Brand.gold.withValues(alpha: 0.45)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('ALREADY LOGGED', style: TextStyle(color: Brand.gold, fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 0.8)),
            const SizedBox(height: 8),
            Text('${f('officerName')} · ${f('shift')}', style: const TextStyle(fontWeight: FontWeight.w700)),
            Text('Reason: ${f('reason')}', style: const TextStyle(color: Brand.textMuted, fontSize: 12)),
            Text('Logged by ${f('submittedBy')}', style: const TextStyle(color: Brand.textMuted, fontSize: 12)),
            Text('Reference ${f('logId')}', style: const TextStyle(color: Brand.textDim, fontSize: 11)),
          ],
        ),
      ),
    );
  }
}

// ── Guard absence ─────────────────────────────────────────────────────────────

const _absenceReasons = [
  'Sudden Illness / Medical Emergency',
  'Unannounced Absence (No-Show)',
  'Family / Personal Emergency',
  'Approved Leave / Off-Duty',
  'Transport / Severe Weather Delay',
];

class AbsenceFormScreen extends ConsumerStatefulWidget {
  const AbsenceFormScreen({super.key});

  @override
  ConsumerState<AbsenceFormScreen> createState() => _AbsenceFormState();
}

class _AbsenceFormState extends ConsumerState<AbsenceFormScreen> with _Submitter {
  String? _siteId, _officerEpf, _replacementEpf;
  String _shift = shifts.first;
  String _reason = _absenceReasons.first;
  bool _replacementDeployed = false;
  final _notes = TextEditingController();

  @override
  void dispose() {
    _notes.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final sites = ref.watch(sitesProvider).value ?? const <Site>[];
    final officers = ref.watch(officersProvider).value ?? const <Officer>[];
    final siteId = _siteId ?? sites.firstOrNull?.siteId;

    return _FormFrame(
      title: 'Guard Absence',
      accent: Brand.danger,
      formKey: formKey,
      busy: busy,
      error: error,
      submitLabel: 'SUBMIT ABSENCE REPORT',
      onSubmit: () => submit(RecordKind.absence, () {
        final site = sites.firstWhere((s) => s.siteId == siteId);
        final officer = officers.firstWhere((o) => o.epf == _officerEpf);
        return {
          'epf': officer.epf,
          'officerName': officer.name,
          'siteId': site.siteId,
          'siteName': site.name,
          'date': _today(),
          'shift': _shift,
          'reason': _reason,
          'replacementDeployed': _replacementDeployed,
          'replacementEpf': _replacementDeployed ? _replacementEpf : null,
          'notes': _notes.text.trim(),
        };
      }, 'Absence report'),
      children: [
        if (existingRecord != null) ...[_ExistingRecordCard(existingRecord!), const SizedBox(height: 12)],
        FormSection(title: 'Who and where', children: [
          _SiteField(
            value: siteId,
            onChanged: (v) => setState(() {
              _siteId = v;
              _officerEpf = null;
              _replacementEpf = null;
            }),
          ),
          _OfficerField(label: 'Absent officer', siteId: siteId, value: _officerEpf, onChanged: (v) => setState(() => _officerEpf = v)),
          PickerField<String>(label: 'Shift', value: _shift, items: shifts, labelOf: (s) => s, onChanged: (v) => setState(() => _shift = v ?? _shift)),
        ]),
        FormSection(title: 'Details', children: [
          PickerField<String>(label: 'Reason', value: _reason, items: _absenceReasons, labelOf: (s) => s, onChanged: (v) => setState(() => _reason = v ?? _reason)),
          SwitchListTile(
            contentPadding: const EdgeInsets.symmetric(horizontal: 4),
            title: const Text('Replacement guard deployed'),
            subtitle: const Text('Leave off if the post is now short-staffed', style: TextStyle(fontSize: 12)),
            value: _replacementDeployed,
            onChanged: (v) => setState(() {
              _replacementDeployed = v;
              if (!v) _replacementEpf = null;
            }),
          ),
          if (_replacementDeployed)
            _OfficerField(
              label: 'Replacement officer',
              siteId: siteId,
              excludeEpf: _officerEpf,
              value: _replacementEpf,
              onChanged: (v) => setState(() => _replacementEpf = v),
            ),
          TextFormField(
            controller: _notes,
            maxLines: 3,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(labelText: 'Notes (optional)', alignLabelWithHint: true),
          ),
        ]),
      ],
    );
  }
}

// ── Late reporting ────────────────────────────────────────────────────────────

const _lateReasons = [
  'Public Transport / Bus Breakdown',
  'Severe Weather / Heavy Rain',
  'Personal / Family Emergency',
  'Traffic Congestion',
  'Overnight Relief Delay',
];

/// Minutes between scheduled and actual arrival, wrapping past midnight for night shifts.
/// Returns null when arrival is more than 12h "late" (i.e. actually earlier than scheduled).
int? lateMinutes(TimeOfDay scheduled, TimeOfDay actual) {
  final diff = ((actual.hour * 60 + actual.minute) - (scheduled.hour * 60 + scheduled.minute) + 1440) % 1440;
  return diff > 720 ? null : diff;
}

String _hhmm(TimeOfDay t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

class LateFormScreen extends ConsumerStatefulWidget {
  const LateFormScreen({super.key});

  @override
  ConsumerState<LateFormScreen> createState() => _LateFormState();
}

class _LateFormState extends ConsumerState<LateFormScreen> with _Submitter {
  String? _siteId, _officerEpf;
  String _shift = shifts.first;
  String _reason = _lateReasons.first;
  TimeOfDay _scheduled = const TimeOfDay(hour: 6, minute: 0);
  TimeOfDay _actual = TimeOfDay.now();
  final _remarks = TextEditingController();

  @override
  void dispose() {
    _remarks.dispose();
    super.dispose();
  }

  Future<void> _pick(bool scheduled) async {
    final picked = await showTimePicker(context: context, initialTime: scheduled ? _scheduled : _actual);
    if (picked != null) setState(() => scheduled ? _scheduled = picked : _actual = picked);
  }

  @override
  Widget build(BuildContext context) {
    final sites = ref.watch(sitesProvider).value ?? const <Site>[];
    final officers = ref.watch(officersProvider).value ?? const <Officer>[];
    final siteId = _siteId ?? sites.firstOrNull?.siteId;
    final delay = lateMinutes(_scheduled, _actual);

    return _FormFrame(
      title: 'Late Reporting',
      accent: Brand.gold,
      formKey: formKey,
      busy: busy,
      error: error,
      submitLabel: 'SUBMIT LATE REPORT',
      onSubmit: () {
        if (delay == null) {
          setState(() => error = 'Actual arrival must be after the scheduled start time.');
          return;
        }
        submit(RecordKind.late, () {
          final site = sites.firstWhere((s) => s.siteId == siteId);
          final officer = officers.firstWhere((o) => o.epf == _officerEpf);
          return {
            'epf': officer.epf,
            'officerName': officer.name,
            'siteId': site.siteId,
            'siteName': site.name,
            'date': _today(),
            'shift': _shift,
            'scheduledTime': _hhmm(_scheduled),
            'actualTime': _hhmm(_actual),
            'delayMinutes': delay,
            'reason': _reason,
            'remarks': _remarks.text.trim(),
          };
        }, 'Late report');
      },
      children: [
        if (existingRecord != null) ...[_ExistingRecordCard(existingRecord!), const SizedBox(height: 12)],
        FormSection(title: 'Who and where', children: [
          _SiteField(value: siteId, onChanged: (v) => setState(() {
                _siteId = v;
                _officerEpf = null;
              })),
          _OfficerField(label: 'Late officer', siteId: siteId, value: _officerEpf, onChanged: (v) => setState(() => _officerEpf = v)),
          PickerField<String>(label: 'Shift', value: _shift, items: shifts, labelOf: (s) => s, onChanged: (v) => setState(() => _shift = v ?? _shift)),
        ]),
        FormSection(title: 'Arrival', children: [
          Row(children: [
            Expanded(child: _TimeButton(label: 'Scheduled', time: _scheduled, onTap: () => _pick(true))),
            const SizedBox(width: 12),
            Expanded(child: _TimeButton(label: 'Actual arrival', time: _actual, onTap: () => _pick(false))),
          ]),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: Brand.surfaceElevated, borderRadius: BorderRadius.circular(12)),
            child: Row(children: [
              const Icon(Icons.timer_outlined, color: Brand.gold),
              const SizedBox(width: 10),
              Text(delay == null ? 'Arrival is before the scheduled time' : 'Delay: $delay minutes',
                  style: TextStyle(fontWeight: FontWeight.w700, color: delay == null ? Brand.danger : Brand.text)),
            ]),
          ),
        ]),
        FormSection(title: 'Details', children: [
          PickerField<String>(label: 'Reason', value: _reason, items: _lateReasons, labelOf: (s) => s, onChanged: (v) => setState(() => _reason = v ?? _reason)),
          TextFormField(
            controller: _remarks,
            maxLines: 3,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(labelText: 'Remarks (optional)', alignLabelWithHint: true),
          ),
        ]),
      ],
    );
  }
}

class _TimeButton extends StatelessWidget {
  const _TimeButton({required this.label, required this.time, required this.onTap});

  final String label;
  final TimeOfDay time;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: onTap,
      child: InputDecorator(
        decoration: InputDecoration(labelText: label, suffixIcon: const Icon(Icons.access_time_rounded)),
        child: Text(time.format(context), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
      ),
    );
  }
}

// ── Incident ──────────────────────────────────────────────────────────────────

const _incidentSubtypes = <String, List<String>>{
  'Security': ['Theft', 'Attempted Theft', 'Burglary / Break-in', 'Trespassing / Unauthorized Entry', 'Property Damage / Vandalism', 'Suspicious Person / Vehicle'],
  'Safety': ['Fire Outbreak / Hazard', 'Water Leakage / Flood', 'Gas Leakage', 'Electrical Short Circuit', 'Lift / Elevator Failure'],
  'Medical': ['Guard Officer Injury', 'Client / Staff Sudden Illness', 'Ambulance Request', 'Fatal Incident'],
  'Operational': ['Equipment / Weapon Failure', 'Relief Guard Unavailable', 'Uniform / Grooming Deficiency', 'Radio / Communication Failure'],
};

const _severities = ['Critical', 'High', 'Medium', 'Low'];

class IncidentFormScreen extends ConsumerStatefulWidget {
  const IncidentFormScreen({super.key});

  @override
  ConsumerState<IncidentFormScreen> createState() => _IncidentFormState();
}

class _IncidentFormState extends ConsumerState<IncidentFormScreen> with _Submitter {
  String? _siteId;
  String _category = 'Security';
  String _subType = _incidentSubtypes['Security']!.first;
  String _severity = 'High';
  bool _police = false, _hospital = false, _fire = false;
  String? _photo; // data URL
  ({double lat, double lng})? _position;
  bool _locating = false;

  final _description = TextEditingController();
  final _witness = TextEditingController();
  final _clientRep = TextEditingController();
  final _action = TextEditingController();
  final _loss = TextEditingController();

  @override
  void dispose() {
    _description.dispose();
    _witness.dispose();
    _clientRep.dispose();
    _action.dispose();
    _loss.dispose();
    super.dispose();
  }

  Future<void> _takePhoto() async {
    try {
      final file = await ImagePicker().pickImage(source: ImageSource.camera, maxWidth: 1280, imageQuality: 70);
      if (file == null) return;
      final bytes = await file.readAsBytes();
      if (mounted) setState(() => _photo = 'data:image/jpeg;base64,${base64Encode(bytes)}');
    } catch (_) {
      if (mounted) showSnack(context, 'Could not open the camera.', error: true);
    }
  }

  Future<void> _locate() async {
    setState(() => _locating = true);
    final p = await currentPosition();
    if (!mounted) return;
    setState(() {
      _position = p;
      _locating = false;
    });
    if (p == null) showSnack(context, 'Location unavailable. Check that location is on and permitted.', error: true);
  }

  @override
  Widget build(BuildContext context) {
    final sites = ref.watch(sitesProvider).value ?? const <Site>[];
    final siteId = _siteId ?? sites.firstOrNull?.siteId;

    return _FormFrame(
      title: 'Report Incident',
      accent: Brand.danger,
      formKey: formKey,
      busy: busy,
      error: error,
      submitLabel: 'SUBMIT INCIDENT REPORT',
      onSubmit: () => submit(RecordKind.incident, () {
        final site = sites.firstWhere((s) => s.siteId == siteId);
        return {
          'category': _category,
          'subType': _subType,
          'severity': _severity,
          'siteId': site.siteId,
          'siteName': site.name,
          'description': _description.text.trim(),
          if (_position != null) 'gpsLat': _position!.lat,
          if (_position != null) 'gpsLng': _position!.lng,
          'photoUrls': [if (_photo != null) _photo],
          'witnessDetails': _witness.text.trim(),
          'clientRepDetails': _clientRep.text.trim(),
          'actionTaken': _action.text.trim(),
          'policeNotified': _police,
          'hospitalNotified': _hospital,
          'fireNotified': _fire,
          'estimatedLoss': _loss.text.trim().isEmpty ? 0 : double.parse(_loss.text.trim()),
        };
      }, 'Incident report'),
      children: [
        FormSection(title: 'Category', children: [
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final c in _incidentSubtypes.keys)
              ChoiceChip(
                label: Text(c),
                selected: _category == c,
                onSelected: (_) => setState(() {
                  _category = c;
                  _subType = _incidentSubtypes[c]!.first;
                }),
              ),
          ]),
          PickerField<String>(label: 'Incident type', value: _subType, items: _incidentSubtypes[_category]!, labelOf: (s) => s, onChanged: (v) => setState(() => _subType = v ?? _subType)),
          PickerField<String>(label: 'Severity', value: _severity, items: _severities, labelOf: (s) => s, onChanged: (v) => setState(() => _severity = v ?? _severity)),
        ]),
        FormSection(title: 'Where', children: [
          _SiteField(value: siteId, onChanged: (v) => setState(() => _siteId = v)),
          OutlinedButton.icon(
            onPressed: _locating ? null : _locate,
            icon: _locating
                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : Icon(_position == null ? Icons.my_location_rounded : Icons.check_circle_rounded, color: _position == null ? null : Brand.success),
            label: Text(_position == null
                ? 'Attach my location'
                : 'Location attached (${_position!.lat.toStringAsFixed(4)}, ${_position!.lng.toStringAsFixed(4)})'),
          ),
        ]),
        FormSection(title: 'What happened', children: [
          TextFormField(
            controller: _description,
            maxLines: 4,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(labelText: 'Description', alignLabelWithHint: true),
            validator: (v) => (v == null || v.trim().length < 10) ? 'Please describe what happened (at least 10 characters)' : null,
          ),
          TextFormField(
            controller: _witness,
            maxLines: 2,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(labelText: 'Witnesses (optional)', alignLabelWithHint: true),
          ),
          TextFormField(
            controller: _clientRep,
            maxLines: 2,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(labelText: 'Client representative: name and contact (optional)', alignLabelWithHint: true),
          ),
          TextFormField(
            controller: _action,
            maxLines: 2,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(labelText: 'Action taken (optional)', alignLabelWithHint: true),
          ),
          TextFormField(
            controller: _loss,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'^\d*\.?\d{0,2}'))],
            decoration: const InputDecoration(labelText: 'Estimated loss (LKR, optional)', prefixText: 'LKR '),
          ),
        ]),
        FormSection(title: 'Authorities notified', children: [
          SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Police'), value: _police, onChanged: (v) => setState(() => _police = v)),
          SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Hospital / ambulance'), value: _hospital, onChanged: (v) => setState(() => _hospital = v)),
          SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Fire brigade'), value: _fire, onChanged: (v) => setState(() => _fire = v)),
        ]),
        FormSection(title: 'Photo evidence', children: [
          if (_photo != null)
            Stack(children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Image.memory(base64Decode(_photo!.split(',').last), height: 180, width: double.infinity, fit: BoxFit.cover),
              ),
              Positioned(
                right: 6,
                top: 6,
                child: IconButton.filled(
                  onPressed: () => setState(() => _photo = null),
                  icon: const Icon(Icons.close_rounded),
                  tooltip: 'Remove photo',
                ),
              ),
            ])
          else
            OutlinedButton.icon(onPressed: _takePhoto, icon: const Icon(Icons.photo_camera_outlined), label: const Text('Take a photo')),
        ]),
      ],
    );
  }
}

// ── Site inspection ───────────────────────────────────────────────────────────

const _ratings = ['Excellent', 'Good', 'Average', 'Poor'];

class InspectionFormScreen extends ConsumerStatefulWidget {
  const InspectionFormScreen({super.key});

  @override
  ConsumerState<InspectionFormScreen> createState() => _InspectionFormState();
}

class _InspectionFormState extends ConsumerState<InspectionFormScreen> with _Submitter {
  String? _siteId;
  String _rating = 'Good';
  bool _uniform = true, _id = true, _register = true, _cctv = true, _fire = true;
  bool _presence = true, _grooming = true, _alarm = true, _clientSat = true, _clean = true, _equipment = true;
  // Weapons / ammunition are only inspected at armed sites; otherwise the item is "not applicable".
  bool _armedSite = false, _weapons = true;
  final _remarks = TextEditingController();

  @override
  void dispose() {
    _remarks.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final sites = ref.watch(sitesProvider).value ?? const <Site>[];
    final siteId = _siteId ?? sites.firstOrNull?.siteId;

    Widget check(String label, bool value, ValueChanged<bool> onChanged) => SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(label),
          value: value,
          onChanged: (v) => setState(() => onChanged(v)),
        );

    return _FormFrame(
      title: 'Site Inspection',
      formKey: formKey,
      busy: busy,
      error: error,
      submitLabel: 'SUBMIT INSPECTION',
      onSubmit: () => submit(RecordKind.inspection, () {
        final site = sites.firstWhere((s) => s.siteId == siteId);
        return {
          'siteId': site.siteId,
          'siteName': site.name,
          'presenceCheck': _presence,
          'uniformCheck': _uniform,
          'idCheck': _id,
          'groomingCheck': _grooming,
          'registerCheck': _register,
          'fireEqCheck': _fire,
          'cctvCheck': _cctv,
          'alarmCheck': _alarm,
          'clientSatisfactionCheck': _clientSat,
          'cleanlinessCheck': _clean,
          'equipmentCheck': _equipment,
          'weaponsCheck': _armedSite ? _weapons : null,
          'siteRating': _rating,
          'remarks': _remarks.text.trim(),
        };
      }, 'Site inspection'),
      children: [
        FormSection(title: 'Site', children: [_SiteField(value: siteId, onChanged: (v) => setState(() => _siteId = v))]),
        FormSection(title: 'Checklist (on = satisfactory)', children: [
          check('Officers present as rostered', _presence, (v) => _presence = v),
          check('Guards in correct uniform', _uniform, (v) => _uniform = v),
          check('ID cards verified', _id, (v) => _id = v),
          check('Grooming and turnout', _grooming, (v) => _grooming = v),
          check('Visitor / occurrence registers and books up to date', _register, (v) => _register = v),
          check('Fire extinguishers in place and in date', _fire, (v) => _fire = v),
          check('CCTV operational', _cctv, (v) => _cctv = v),
          check('Alarm system operational', _alarm, (v) => _alarm = v),
          check('Client satisfied with service', _clientSat, (v) => _clientSat = v),
          check('Guard room / post clean and tidy', _clean, (v) => _clean = v),
          check('Equipment in place (torch, baton, radio, etc.)', _equipment, (v) => _equipment = v),
          check('Armed site: weapons and ammunition inspected', _armedSite, (v) => _armedSite = v),
          if (_armedSite) check('Weapons and ammunition correct and secure', _weapons, (v) => _weapons = v),
        ]),
        FormSection(title: 'Overall rating', children: [
          SegmentedButton<String>(
            segments: [for (final r in _ratings) ButtonSegment(value: r, label: Text(r, style: const TextStyle(fontSize: 12)))],
            selected: {_rating},
            showSelectedIcon: false,
            onSelectionChanged: (s) => setState(() => _rating = s.first),
          ),
          TextFormField(
            controller: _remarks,
            maxLines: 3,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(labelText: 'Remarks (optional)', alignLabelWithHint: true),
          ),
        ]),
      ],
    );
  }
}
