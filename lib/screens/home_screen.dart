import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
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
    
    return Scaffold(
      body: IndexedStack(
        index: _currentIndex,
        children: _screens,
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentIndex,
        onDestinationSelected: (index) {
          setState(() => _currentIndex = index);
        },
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.chat_outlined),
            selectedIcon: Icon(Icons.chat),
            label: 'Czat',
          ),
          NavigationDestination(
            icon: Icon(Icons.list_outlined),
            selectedIcon: Icon(Icons.list),
            label: 'Sesje',
          ),
          NavigationDestination(
            icon: Icon(Icons.settings_outlined),
            selectedIcon: Icon(Icons.settings),
            label: 'Ustawienia',
          ),
        ],
      ),
      floatingActionButton: _buildConnectionIndicator(connectionState),
    );
  }

  Widget? _buildConnectionIndicator(ConnectionState state) {
    if (state is Connected) return null;
    
    Color color;
    IconData icon;
    String tooltip;

    switch (state) {
      case Connecting():
        color = Colors.orange;
        icon = Icons.sync;
        tooltip = 'Łączenie...';
        break;
      case ConnectionError():
        color = Colors.red;
        icon = Icons.error;
        tooltip = 'Błąd połączenia';
        break;
      default:
        color = Colors.grey;
        icon = Icons.cloud_off;
        tooltip = 'Rozłączono';
    }

    return FloatingActionButton.small(
      backgroundColor: color,
      onPressed: () {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(tooltip)),
        );
      },
      child: Icon(icon, color: Colors.white),
    );
  }
}
