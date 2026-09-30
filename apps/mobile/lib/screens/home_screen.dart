import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../main.dart' show OmniColors;
import '../providers/chat_provider.dart';
import '../providers/session_provider.dart';
import '../services/websocket_service.dart';
import 'chat_screen.dart';
import 'sessions_screen.dart';
import 'settings_screen.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  int _currentIndex = 0;

  final _screens = const [
    ChatScreen(),
    SessionsScreen(),
    SettingsScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    final connectionState = ref.watch(webSocketProvider);
    final connected = connectionState is Connected;

    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        titleSpacing: 12,
        title: Row(
          children: [
            ClipOval(
              child: Image.asset(
                'assets/images/logo.png',
                width: 32,
                height: 32,
                fit: BoxFit.cover,
              ),
            ),
            const SizedBox(width: 10),
            const Text(
              'Omni',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
          ],
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: Row(
              children: [
                Icon(
                  connected ? Icons.cloud_done : Icons.cloud_off,
                  size: 18,
                  color: connected ? Colors.green : Colors.orange,
                ),
                const SizedBox(width: 6),
                Text(
                  connected ? 'Połączono' : 'Niepołączono',
                  style: const TextStyle(fontSize: 12),
                ),
              ],
            ),
          ),
        ],
      ),
      body: Container(
        decoration: const BoxDecoration(
          image: DecorationImage(
            image: AssetImage('assets/images/background.png'),
            fit: BoxFit.cover,
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              if (!connected) _offlineHint(context),
              Expanded(
                child: IndexedStack(
                  index: _currentIndex,
                  children: _screens,
                ),
              ),
            ],
          ),
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentIndex,
        onDestinationSelected: (index) {
          setState(() => _currentIndex = index);
        },
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.chat_bubble_outline),
            selectedIcon: Icon(Icons.chat_bubble),
            label: 'Rozmowa',
            tooltip: 'Napisz do agenta Omni',
          ),
          NavigationDestination(
            icon: Icon(Icons.history_outlined),
            selectedIcon: Icon(Icons.history),
            label: 'Historia',
            tooltip: 'Twoje wcześniejsze rozmowy',
          ),
          NavigationDestination(
            icon: Icon(Icons.settings_outlined),
            selectedIcon: Icon(Icons.settings),
            label: 'Ustawienia',
            tooltip: 'Połączenie i konfiguracja',
          ),
        ],
      ),
    );
  }

  /// Plain-language hint for non-technical users when the bot is unreachable.
  Widget _offlineHint(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.orange.withOpacity(0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.orange.withOpacity(0.4)),
      ),
      child: Row(
        children: [
          const Icon(Icons.info_outline, color: Colors.orange, size: 20),
          const SizedBox(width: 10),
          const Expanded(
            child: Text(
              'Bot nie jest jeszcze połączony. Wejdź w „Ustawienia", aby go uruchomić i połączyć.',
              style: TextStyle(fontSize: 13),
            ),
          ),
          TextButton(
            onPressed: () => setState(() => _currentIndex = 2),
            child: const Text('Ustawienia'),
          ),
        ],
      ),
    );
  }
}
