import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../models/message.dart';
import '../models/ws_message.dart';
import '../services/websocket_service.dart';

class ChatNotifier extends StateNotifier<ChatState> {
  final WebSocketService _webSocketService;
  final _uuid = const Uuid();

  ChatNotifier(this._webSocketService) : super(const ChatState()) {
    _setupListeners();
  }

  void _setupListeners() {
    _webSocketService.messageStream.listen((message) {
      _handleWsMessage(message);
    });
  }

  void _handleWsMessage(WsMessage message) {
    switch (message.type) {
      case 'chat.token':
        _handleToken(message);
        break;
      case 'chat.done':
        _handleDone(message);
        break;
      case 'task.started':
        _handleTaskStarted(message);
        break;
      case 'task.finished':
        _handleTaskFinished(message);
        break;
      case 'error':
        _handleError(message);
        break;
    }
  }

  void _handleToken(WsMessage message) {
    if (message.token == null) return;

    final messages = List<ChatMessage>.from(state.messages);
    final lastMessage = messages.isNotEmpty ? messages.last : null;

    if (lastMessage != null && 
        lastMessage.role == MessageRole.agent && 
        lastMessage.isStreaming) {
      // Aktualizuj istniejącą wiadomość
      messages[messages.length - 1] = lastMessage.copyWith(
        content: lastMessage.content + message.token!,
      );
    } else {
      // Nowa wiadomość agenta
      messages.add(ChatMessage(
        id: _uuid.v4(),
        role: MessageRole.agent,
        content: message.token!,
        timestamp: DateTime.now(),
        isStreaming: true,
      ));
    }

    state = state.copyWith(messages: messages);
  }

  void _handleDone(WsMessage message) {
    if (message.fullText == null) return;

    final messages = List<ChatMessage>.from(state.messages);
    final lastMessage = messages.isNotEmpty ? messages.last : null;

    if (lastMessage != null && lastMessage.role == MessageRole.agent) {
      messages[messages.length - 1] = lastMessage.copyWith(
        content: message.fullText!,
        isStreaming: false,
      );
    }

    state = state.copyWith(
      messages: messages,
      isLoading: false,
    );
  }

  void _handleTaskStarted(WsMessage message) {
    state = state.copyWith(isLoading: true);
  }

  void _handleTaskFinished(WsMessage message) {
    state = state.copyWith(isLoading: false);
  }

  void _handleError(WsMessage message) {
    state = state.copyWith(
      isLoading: false,
      error: message.error,
    );
  }

  void sendMessage(String content) {
    final userMessage = ChatMessage(
      id: _uuid.v4(),
      role: MessageRole.user,
      content: content,
      timestamp: DateTime.now(),
    );

    state = state.copyWith(
      messages: [...state.messages, userMessage],
      isLoading: true,
      error: null,
    );

    _webSocketService.sendChatMessage(content, sessionId: state.sessionId);
  }

  void clearChat() {
    state = const ChatState();
  }

  void setSessionId(String sessionId) {
    state = state.copyWith(sessionId: sessionId);
  }

  void clearError() {
    state = state.copyWith(error: null);
  }
}

class ChatState {
  final List<ChatMessage> messages;
  final bool isLoading;
  final String? error;
  final String? sessionId;

  const ChatState({
    this.messages = const [],
    this.isLoading = false,
    this.error,
    this.sessionId,
  });

  ChatState copyWith({
    List<ChatMessage>? messages,
    bool? isLoading,
    String? error,
    String? sessionId,
  }) {
    return ChatState(
      messages: messages ?? this.messages,
      isLoading: isLoading ?? this.isLoading,
      error: error,
      sessionId: sessionId ?? this.sessionId,
    );
  }
}

final chatProvider = StateNotifierProvider<ChatNotifier, ChatState>((ref) {
  final webSocketService = ref.watch(webSocketProvider.notifier);
  return ChatNotifier(webSocketService);
});
