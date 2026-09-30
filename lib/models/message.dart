import 'package:freezed_annotation/freezed_annotation.dart';

part 'message.freezed.dart';
part 'message.g.dart';

@freezed
class ChatMessage with _$ChatMessage {
  const factory ChatMessage({
    required String id,
    required MessageRole role,
    required String content,
    required DateTime timestamp,
    @Default(false) bool isStreaming,
    String? toolCallId,
    Map<String, dynamic>? metadata,
  }) = _ChatMessage;

  factory ChatMessage.fromJson(Map<String, dynamic> json) =>
      _$ChatMessageFromJson(json);
}

enum MessageRole {
  user,
  agent,
  system;

  String get displayName {
    switch (this) {
      case MessageRole.user:
        return 'Ty';
      case MessageRole.agent:
        return 'Omni';
      case MessageRole.system:
        return 'System';
    }
  }
}
