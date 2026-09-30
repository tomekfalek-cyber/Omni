import 'package:freezed_annotation/freezed_annotation.dart';

part 'ws_message.freezed.dart';
part 'ws_message.g.dart';

@freezed
class WsMessage with _$WsMessage {
  const factory WsMessage({
    required String type,
    String? sessionId,
    String? taskId,
    String? token,
    String? fullText,
    String? error,
    String? status,
    String? result,
    Map<String, dynamic>? data,
  }) = _WsMessage;

  factory WsMessage.fromJson(Map<String, dynamic> json) =>
      _$WsMessageFromJson(json);
}
