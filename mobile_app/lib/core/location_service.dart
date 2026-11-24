import 'dart:async';

import 'package:geolocator/geolocator.dart';

/// Best-effort device position. Returns null (never throws) when location is switched off,
/// permission is denied, or no fix arrives in time — callers then send no coordinates
/// rather than a made-up location.
Future<({double lat, double lng})?> currentPosition({
  Duration timeout = const Duration(seconds: 8),
}) async {
  try {
    if (!await Geolocator.isLocationServiceEnabled()) return null;

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
      return null;
    }

    final position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
    ).timeout(timeout);
    return (lat: position.latitude, lng: position.longitude);
  } on TimeoutException {
    return null;
  } catch (_) {
    return null;
  }
}
