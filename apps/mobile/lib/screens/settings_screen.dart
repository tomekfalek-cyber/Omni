import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/gateway_config.dart';
import '../services/storage_service.dart';
import '../services/websocket_service.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  final _urlController = TextEditingController();
  final _tokenController = TextEditingController();
  final _deviceNameController = TextEditingController();
  bool _autoConnect = true;

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    final storage = ref.read(storageServiceProvider);
    final config = await storage.loadGatewayConfig();

    if (config != null) {
      _urlController.text = config.url;
      _tokenController.text = config.token;
      _deviceNameController.text = config.deviceName;
      _autoConnect = config.autoConnect;
    }
  }

  @override
  void dispose() {
    _urlController.dispose();
    _tokenController.dispose();
    _deviceNameController.dispose();
    super.dispose();
  }

  Future<void> _saveSettings() async {
    final config = GatewayConfig(
      url: _urlController.text.trim(),
      token: _tokenController.text.trim(),
      deviceName: _deviceNameController.text.trim(),
      autoConnect: _autoConnect,
    );

    final storage = ref.read(storageServiceProvider);
    await storage.saveGatewayConfig(config);

    if (_autoConnect) {
      await ref.read(webSocketProvider.notifier).connect(config);
    }

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Zapisano ustawienia')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final connectionState = ref.watch(webSocketProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Ustawienia'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildConnectionStatus(connectionState),
          const SizedBox(height: 16),
          _buildHelpCard(),
          const SizedBox(height: 24),
          _buildSection(
            title: 'Połączenie z botem',
            description: 'Adres i hasło, które dostałeś razem z botem Omni.',
            children: [
              TextField(
                controller: _urlController,
                decoration: const InputDecoration(
                  labelText: 'Adres bota (Gateway)',
                  helperText: 'Np. ws://localhost:7800 — zostaw, jeśli nie wiesz',
                  border: OutlineInputBorder(),
                ),
                keyboardType: TextInputType.url,
              ),
              const SizedBox(height: 16),
              TextField(
                controller: _tokenController,
                decoration: const InputDecoration(
                  labelText: 'Hasło dostępu (token)',
                  helperText: 'Znajdziesz je w pliku .env obok bota',
                  border: OutlineInputBorder(),
                ),
                obscureText: true,
              ),
            ],
          ),
          const SizedBox(height: 24),
          _buildSection(
            title: 'To urządzenie',
            description: 'Jak bot ma rozpoznawać ten telefon.',
            children: [
              TextField(
                controller: _deviceNameController,
                decoration: const InputDecoration(
                  labelText: 'Nazwa urządzenia',
                  hintText: 'Np. Telefon Tomka',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 8),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Łącz automatycznie przy starcie'),
                subtitle: const Text('Bot połączy się sam, gdy otworzysz aplikację'),
                value: _autoConnect,
                onChanged: (value) {
                  setState(() => _autoConnect = value);
                },
              ),
            ],
          ),
          const SizedBox(height: 32),
          ElevatedButton.icon(
            icon: const Icon(Icons.save),
            label: const Text('Zapisz i połącz'),
            onPressed: _saveSettings,
            style: ElevatedButton.styleFrom(
              minimumSize: const Size(double.infinity, 48),
            ),
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            icon: const Icon(Icons.refresh),
            label: const Text('Połącz ponownie'),
            onPressed: () async {
              final config = GatewayConfig(
                url: _urlController.text.trim(),
                token: _tokenController.text.trim(),
                deviceName: _deviceNameController.text.trim(),
                autoConnect: _autoConnect,
              );
              await ref.read(webSocketProvider.notifier).connect(config);
            },
            style: OutlinedButton.styleFrom(
              minimumSize: const Size(double.infinity, 48),
            ),
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  Widget _buildHelpCard() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: const [
            Row(
              children: [
                Icon(Icons.lightbulb_outline),
                SizedBox(width: 8),
                Text('Jak to działa?', style: TextStyle(fontWeight: FontWeight.bold)),
              ],
            ),
            SizedBox(height: 8),
            Text('1. Bot (Omni) działa na Twoim komputerze.'),
            Text('2. Telefon łączy się z nim przez ten sam adres.'),
            Text('3. Jeśli nie działa — sprawdź, czy bot jest uruchomiony, i wciśnij „Połącz ponownie".'),
          ],
        ),
      ),
    );
  }

  Widget _buildConnectionStatus(ConnectionState state) {
    Color color;
    IconData icon;
    String text;
    String hint;

    switch (state) {
      case Connected():
        color = Colors.green;
        icon = Icons.check_circle;
        text = 'Połączono z botem';
        hint = 'Wszystko gotowe — możesz rozmawiać.';
        break;
      case Connecting():
        color = Colors.orange;
        icon = Icons.sync;
        text = 'Łączenie…';
        hint = 'Trwa próba połączenia z botem.';
        break;
      case ConnectionError():
        color = Colors.red;
        icon = Icons.error;
        text = 'Nie udało się połączyć';
        hint = 'Sprawdź adres, hasło i czy bot jest uruchomiony.';
        break;
      default:
        color = Colors.grey;
        icon = Icons.cloud_off;
        text = 'Nie połączono';
        hint = 'Wpisz dane poniżej i zapisz.';
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(icon, color: color, size: 32),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    text,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: color,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    hint,
                    style: const TextStyle(fontSize: 12, color: Colors.grey),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSection({
    required String title,
    required List<Widget> children,
    String? description,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
        ),
        if (description != null) ...[
          const SizedBox(height: 4),
          Text(
            description,
            style: const TextStyle(fontSize: 13, color: Colors.grey),
          ),
        ],
        const SizedBox(height: 12),
        ...children,
      ],
    );
  }
}
