import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/gateway_config.dart';
import '../models/session.dart';

class StorageService {
  static const String _gatewayConfigKey = 'gateway_config';
  static const String _sessionsKey = 'sessions';

  Future<void> saveGatewayConfig(GatewayConfig config) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_gatewayConfigKey, jsonEncode(config.toJson()));
  }

  Future<GatewayConfig?> loadGatewayConfig() async {
    final prefs = await SharedPreferences.getInstance();
    final json = prefs.getString(_gatewayConfigKey);
    if (json == null) return null;
    
    try {
      return GatewayConfig.fromJson(jsonDecode(json));
    } catch (e) {
      return null;
    }
  }

  Future<void> saveSessions(List<Session> sessions) async {
    final prefs = await SharedPreferences.getInstance();
    final jsonList = sessions.map((s) => s.toJson()).toList();
    await prefs.setString(_sessionsKey, jsonEncode(jsonList));
  }

  Future<List<Session>> loadSessions() async {
    final prefs = await SharedPreferences.getInstance();
    final json = prefs.getString(_sessionsKey);
    if (json == null) return [];
    
    try {
      final List<dynamic> jsonList = jsonDecode(json);
      return jsonList.map((j) => Session.fromJson(j)).toList();
    } catch (e) {
      return [];
    }
  }

  Future<void> clearAll() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.clear();
  }
}

final storageServiceProvider = Provider<StorageService>((ref) {
  return StorageService();
});
