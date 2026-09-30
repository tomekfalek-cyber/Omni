import 'package:freezed_annotation/freezed_annotation.dart';

part 'gateway_config.freezed.dart';
part 'gateway_config.g.dart';

@freezed
class GatewayConfig with _$GatewayConfig {
  const factory GatewayConfig({
    required String url,
    required String token,
    @Default('Omni Agent') String deviceName,
    @Default(true) bool autoConnect,
  }) = _GatewayConfig;

  factory GatewayConfig.fromJson(Map<String, dynamic> json) =>
      _$GatewayConfigFromJson(json);
}
