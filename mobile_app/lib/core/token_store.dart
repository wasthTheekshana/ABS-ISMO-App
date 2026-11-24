import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Persists the session JWT in the platform keystore (Android Keystore / iOS Keychain),
/// never in plain SharedPreferences.
class TokenStore {
  TokenStore([FlutterSecureStorage? storage])
      : _storage = storage ?? const FlutterSecureStorage();

  static const _key = 'isoms_session_token';
  final FlutterSecureStorage _storage;

  Future<String?> read() async {
    try {
      return await _storage.read(key: _key);
    } catch (_) {
      return null; // a corrupt keystore entry must not brick the app: force a fresh login
    }
  }

  Future<void> write(String token) => _storage.write(key: _key, value: token);

  Future<void> clear() async {
    try {
      await _storage.delete(key: _key);
    } catch (_) {}
  }
}
