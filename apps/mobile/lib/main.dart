import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'screens/home_screen.dart';

/// Omni „Granat" palette — deep navy with electric-blue accents.
/// Matches the app logo and background (assets/images/background.png).
class OmniColors {
  static const Color granat = Color(0xFF0A1128);
  static const Color granatDeep = Color(0xFF05091A);
  static const Color panel = Color(0xFF0B1730);
  static const Color accent = Color(0xFF3D7BFD);
  static const Color accentGlow = Color(0xFF7FD8FF);
  static const Color text = Color(0xFFE6EDF7);
}

void main() {
  runApp(
    const ProviderScope(
      child: OmniApp(),
    ),
  );
}

class OmniApp extends StatelessWidget {
  const OmniApp({super.key});

  @override
  Widget build(BuildContext context) {
    final scheme = ColorScheme.fromSeed(
      seedColor: OmniColors.accent,
      brightness: Brightness.dark,
    ).copyWith(
      surface: OmniColors.granat,
      primary: OmniColors.accent,
      secondary: OmniColors.accentGlow,
    );

    return MaterialApp(
      title: 'Omni Agent',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: scheme,
        useMaterial3: true,
        scaffoldBackgroundColor: OmniColors.granat,
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.transparent,
          elevation: 0,
          centerTitle: false,
        ),
        navigationBarTheme: NavigationBarThemeData(
          backgroundColor: OmniColors.granatDeep,
          indicatorColor: OmniColors.accent,
        ),
        floatingActionButtonTheme: const FloatingActionButtonThemeData(
          backgroundColor: OmniColors.accent,
        ),
      ),
      home: const HomeScreen(),
    );
  }
}
