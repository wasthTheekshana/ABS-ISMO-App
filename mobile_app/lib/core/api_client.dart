import 'dart:async';

import 'package:dio/dio.dart';

import 'config.dart';
import 'token_store.dart';

/// A failure from the ISOMS API, already translated into something a user can read.
class ApiException implements Exception {
  const ApiException(this.message, {this.status, this.details});

  final String message;
  final int? status;

  /// Raw error body. On a 409 duplicate this carries `existingRecord`.
  final Map<String, dynamic>? details;

  bool get isUnauthorized => status == 401;
  bool get isConflict => status == 409;

  Map<String, dynamic>? get existingRecord {
    final record = details?['existingRecord'];
    return record is Map<String, dynamic> ? record : null;
  }

  @override
  String toString() => message;
}

/// Thin typed wrapper over Dio. The Bearer token is attached on every request; a 401
/// from the server calls [onUnauthorized] once so the app can drop to the login screen.
class ApiClient {
  ApiClient({required this._tokenStore, this.onUnauthorized, Dio? dio}) : _dio = dio ?? Dio() {
    _dio.options
      ..baseUrl = AppConfig.apiBaseUrl
      ..connectTimeout = AppConfig.connectTimeout
      ..receiveTimeout = AppConfig.receiveTimeout
      ..headers = {'Content-Type': 'application/json'};

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await _tokenStore.read();
          if (token != null) options.headers['Authorization'] = 'Bearer $token';
          handler.next(options);
        },
      ),
    );
  }

  final Dio _dio;
  final TokenStore _tokenStore;
  final void Function()? onUnauthorized;

  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) =>
      _send(() => _dio.get<Map<String, dynamic>>(path, queryParameters: query));

  Future<Map<String, dynamic>> post(String path, {Object? body}) =>
      _send(() => _dio.post<Map<String, dynamic>>(path, data: body));

  Future<Map<String, dynamic>> patch(String path, {Object? body}) =>
      _send(() => _dio.patch<Map<String, dynamic>>(path, data: body));

  Future<Map<String, dynamic>> _send(
    Future<Response<Map<String, dynamic>>> Function() request,
  ) async {
    try {
      final response = await request();
      return response.data ?? const {};
    } on DioException catch (e) {
      throw _translate(e);
    }
  }

  ApiException _translate(DioException e) {
    final status = e.response?.statusCode;
    final data = e.response?.data;
    final body = data is Map<String, dynamic> ? data : null;

    if (status == 401 && !(e.requestOptions.path.endsWith('/auth/login'))) {
      onUnauthorized?.call();
    }

    final serverMessage = body?['error'];
    if (serverMessage is String && serverMessage.isNotEmpty) {
      return ApiException(serverMessage, status: status, details: body);
    }

    return switch (e.type) {
      DioExceptionType.connectionTimeout ||
      DioExceptionType.receiveTimeout ||
      DioExceptionType.sendTimeout =>
        const ApiException('The server took too long to respond. Check your connection and try again.'),
      DioExceptionType.connectionError =>
        const ApiException('Cannot reach the ISOMS server. Check your network connection.'),
      _ => ApiException('Request failed${status != null ? ' (HTTP $status)' : ''}', status: status),
    };
  }
}
