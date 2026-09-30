import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../models/session.dart';
import '../services/storage_service.dart';

class SessionNotifier extends StateNotifier<SessionState> {
  final StorageService _storageService;
  final _uuid = const Uuid();

  SessionNotifier(this._storageService) : super(const SessionState()) {
    _loadSessions();
  }

  Future<void> _loadSessions() async {
    final sessions = await _storageService.loadSessions();
    state = state.copyWith(sessions: sessions);
  }

  Future<void> createSession(String title) async {
    final session = Session(
      id: _uuid.v4(),
      title: title,
      lastMessage: '',
      updatedAt: DateTime.now(),
    );

    final sessions = [session, ...state.sessions];
    state = state.copyWith(sessions: sessions, activeSessionId: session.id);
    await _storageService.saveSessions(sessions);
  }

  Future<void> updateSession(String sessionId, {String? lastMessage, int? messageCount}) async {
    final sessions = state.sessions.map((s) {
      if (s.id == sessionId) {
        return s.copyWith(
          lastMessage: lastMessage ?? s.lastMessage,
          messageCount: messageCount ?? s.messageCount,
          updatedAt: DateTime.now(),
        );
      }
      return s;
    }).toList();

    state = state.copyWith(sessions: sessions);
    await _storageService.saveSessions(sessions);
  }

  Future<void> deleteSession(String sessionId) async {
    final sessions = state.sessions.where((s) => s.id != sessionId).toList();
    state = state.copyWith(sessions: sessions);
    await _storageService.saveSessions(sessions);
  }

  void setActiveSession(String? sessionId) {
    state = state.copyWith(activeSessionId: sessionId);
  }

  Future<void> clearAllSessions() async {
    state = const SessionState();
    await _storageService.saveSessions([]);
  }
}

class SessionState {
  final List<Session> sessions;
  final String? activeSessionId;

  const SessionState({
    this.sessions = const [],
    this.activeSessionId,
  });

  SessionState copyWith({
    List<Session>? sessions,
    String? activeSessionId,
  }) {
    return SessionState(
      sessions: sessions ?? this.sessions,
      activeSessionId: activeSessionId ?? this.activeSessionId,
    );
  }
}

final sessionProvider = StateNotifierProvider<SessionNotifier, SessionState>((ref) {
  final storageService = ref.watch(storageServiceProvider);
  return SessionNotifier(storageService);
});
