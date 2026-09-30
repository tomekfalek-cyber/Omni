import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/ws_message.dart';
import '../models/gateway_config.dart';

class WebSocketService extends StateNotifier<ConnectionState> {
  WebSocketChannel? _channel;
  StreamSubscription? _subscription;
  GatewayConfig? _config;
  Timer? _reconnectTimer;
  Timer? _heartbeatTimer;
  int _reconnectAttempts = 0;
  static const int maxReconnectAttempts = 5;
  static const Duration reconnectDelay = Duration(seconds: 3);
  static const Duration heartbeatInterval = Duration(seconds: 30);

  WebSocketService() : super(const ConnectionState.disconnected());

  Future<void> connect(GatewayConfig config) async {
    _config = config;
    _reconnectAttempts = 0;
    await _attemptConnection();
  }

  Future<void> _attemptConnection() async {
    if (_config == null) return;

    try {
      state = const ConnectionState.connecting();
      
      final uri = Uri.parse('${_config!.url}/ws');
      _channel = WebSocketChannel.connect(uri);
      
      await _channel!.ready;
      
      _subscription = _channel!.stream.listen(
        _handleMessage,
        onError: _handleError,
        onDone: _handleDisconnect,
      );

      // Wyślij autoryzację
      _sendAuth();
      
      // Uruchom heartbeat
      _startHeartbeat();
      
      state = const ConnectionState.connected();
      _reconnectAttempts = 0;
      
    } catch (e) {
      state = ConnectionState.error(e.toString());
      await _scheduleReconnect();
    }
  }

  void _sendAuth() {
    if (_config == null || _channel == null) return;
    
    final authMessage = {
      'type': 'auth',
      'token': _config!.token,
      'userId': 'mobile-${DateTime.now().millisecondsSinceEpoch}',
    };
    
    _channel!.sink.add(jsonEncode(authMessage));
  }

  void _startHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(heartbeatInterval, (_) {
      if (_channel != null && state is ConnectionState.Connected) {
        _channel!.sink.add(jsonEncode({'type': 'ping'}));
      }
    });
  }

  void _handleMessage(dynamic message) {
    try {
      final json = jsonDecode(message as String);
      final wsMessage = WsMessage.fromJson(json);
      
      switch (wsMessage.type) {
        case 'auth.ok':
          state = const ConnectionState.connected();
          break;
        case 'auth.fail':
          state = ConnectionState.error('Auth failed: ${wsMessage.error}');
          disconnect();
          break;
        case 'pong':
          // Heartbeat response
          break;
        default:
          // Emituj do subskrybentów
          _messageController.add(wsMessage);
      }
    } catch (e) {
      print('Error parsing WebSocket message: $e');
    }
  }

  void _handleError(dynamic error) {
    state = ConnectionState.error(error.toString());
    _scheduleReconnect();
  }

  void _handleDisconnect() {
    state = const ConnectionState.disconnected();
    _scheduleReconnect();
  }

  Future<void> _scheduleReconnect() async {
    if (_reconnectAttempts >= maxReconnectAttempts) {
      state = const ConnectionState.error('Max reconnect attempts reached');
      return;
    }

    _reconnectAttempts++;
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(reconnectDelay, _attemptConnection);
  }

  void sendMessage(Map<String, dynamic> message) {
    if (_channel == null || state is! ConnectionState.Connected) {
      throw Exception('WebSocket not connected');
    }
    
    _channel!.sink.add(jsonEncode(message));
  }

  void sendChatMessage(String message, {String? sessionId}) {
    sendMessage({
      'type': 'chat.send',
      'message': message,
      if (sessionId != null) 'sessionId': sessionId,
    });
  }

  void sendApprovalResponse(String callId, bool approved) {
    sendMessage({
      'type': 'approval.response',
      'callId': callId,
      'approved': approved,
    });
  }

  Future<void> disconnect() async {
    _heartbeatTimer?.cancel();
    _reconnectTimer?.cancel();
    await _subscription?.cancel();
    await _channel?.sink.close();
    _channel = null;
    state = const ConnectionState.disconnected();
  }

  final _messageController = StreamController<WsMessage>.broadcast();
  Stream<WsMessage> get messageStream => _messageController.stream;

  @override
  void dispose() {
    disconnect();
    _messageController.close();
    super.dispose();
  }
}

sealed class ConnectionState {
  const ConnectionState();
  
  const factory ConnectionState.disconnected() = Disconnected;
  const factory ConnectionState.connecting() = Connecting;
  const factory ConnectionState.connected() = Connected;
  const factory ConnectionState.error(String message) = ConnectionError;
}

final webSocketProvider = StateNotifierProvider<WebSocketService, ConnectionState>((ref) {
  return WebSocketService();
});
