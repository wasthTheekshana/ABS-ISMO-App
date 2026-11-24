import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// AB Securitas "Duty Register" palette and type (matches the web app's design tokens).
///
/// Register paper and ink, uniform green, badge brass. The constant names are unchanged from the
/// earlier dark theme so every screen picks up the new look; the meanings are the same
/// (danger is red, success is green, primary is the main accent).
class Brand {
  const Brand._();

  // Brand colours from absecuritas.com: primary purple #7C1C7C (the logo), deep plum #2D052D,
  // soft lilac #F7F1F7 and the warm orange accent.
  static const bg = Color(0xFFF7F1F7); // soft lilac page
  static const surface = Color(0xFFFFFFFF);
  static const surfaceElevated = Color(0xFFF1E4F1); // brand tint
  static const border = Color(0xFFE6D9E6);
  static const borderStrong = Color(0xFFC9B3C9);
  static const text = Color(0xFF1E1220);
  static const textMuted = Color(0xFF6B5A6E);
  static const textDim = Color(0xFF75637A);
  static const primary = Color(0xFF7C1C7C); // brand purple
  static const onPrimary = Color(0xFFFFFFFF);
  static const sidebar = Color(0xFF2D052D); // deep plum: app bar and sign-in page
  static const gold = Color(0xFFA8441A); // accent dark enough to read as text
  static const brass = Color(0xFFE8793F); // accent orange for fills and icons
  static const success = Color(0xFF1F7A4D);
  static const danger = Color(0xFFC62828);

  static const fontBody = 'PublicSans';
  static const fontDisplay = 'BigShoulders';

  /// Signage numerals for readings (on duty, shortfall, counts).
  static TextStyle numeral({double size = 40, Color? color}) => TextStyle(
        fontFamily: fontDisplay,
        fontWeight: FontWeight.w800,
        fontSize: size,
        height: 0.95,
        color: color ?? text,
        fontFeatures: const [FontFeature.tabularFigures()],
      );
}

ThemeData buildTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: Brand.primary,
    brightness: Brightness.light,
  ).copyWith(
    surface: Brand.surface,
    primary: Brand.primary,
    onPrimary: Brand.onPrimary,
    secondary: Brand.brass,
    error: Brand.danger,
    onSurface: Brand.text,
    outline: Brand.borderStrong,
  );

  const radius = BorderRadius.all(Radius.circular(5));
  OutlineInputBorder border(Color c, [double w = 2]) =>
      OutlineInputBorder(borderRadius: radius, borderSide: BorderSide(color: c, width: w));

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    fontFamily: Brand.fontBody,
    scaffoldBackgroundColor: Brand.bg,
    appBarTheme: const AppBarTheme(
      backgroundColor: Brand.sidebar,
      foregroundColor: Brand.onPrimary,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      systemOverlayStyle: SystemUiOverlayStyle.light,
      titleTextStyle: TextStyle(
        fontFamily: Brand.fontDisplay,
        fontSize: 26,
        fontWeight: FontWeight.w800,
        letterSpacing: 0.5,
        color: Brand.onPrimary,
      ),
    ),
    cardTheme: CardThemeData(
      color: Brand.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: const BorderRadius.all(Radius.circular(8)),
        side: const BorderSide(color: Brand.border),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Brand.surface,
      border: border(Brand.borderStrong),
      enabledBorder: border(Brand.borderStrong),
      focusedBorder: border(const Color(0xFF1D6A80), 2.5),
      errorBorder: border(Brand.danger),
      focusedErrorBorder: border(Brand.danger, 2.5),
      labelStyle: const TextStyle(color: Brand.textMuted),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: Brand.primary,
        foregroundColor: Brand.onPrimary,
        minimumSize: const Size.fromHeight(52),
        shape: const RoundedRectangleBorder(borderRadius: radius),
        textStyle: const TextStyle(fontWeight: FontWeight.w700, letterSpacing: 0.3),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: Brand.text,
        minimumSize: const Size.fromHeight(52),
        side: const BorderSide(color: Brand.borderStrong, width: 2),
        shape: const RoundedRectangleBorder(borderRadius: radius),
        textStyle: const TextStyle(fontWeight: FontWeight.w700),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: Brand.primary, textStyle: const TextStyle(fontWeight: FontWeight.w700)),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Brand.surface,
      surfaceTintColor: Colors.transparent,
      indicatorColor: Brand.brass.withValues(alpha: 0.28),
      labelTextStyle: WidgetStateProperty.resolveWith(
        (states) => TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          color: states.contains(WidgetState.selected) ? Brand.text : Brand.textMuted,
        ),
      ),
      iconTheme: WidgetStateProperty.resolveWith(
        (states) => IconThemeData(color: states.contains(WidgetState.selected) ? Brand.text : Brand.textMuted),
      ),
    ),
    tabBarTheme: const TabBarThemeData(
      indicatorColor: Brand.brass,
      labelColor: Brand.text,
      unselectedLabelColor: Brand.textMuted,
      dividerColor: Brand.border,
      labelStyle: TextStyle(fontWeight: FontWeight.w700),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: Brand.bg,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: Brand.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8), side: const BorderSide(color: Brand.border)),
    ),
    snackBarTheme: const SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: Brand.text,
      contentTextStyle: TextStyle(color: Brand.bg, fontWeight: FontWeight.w600),
    ),
    dividerColor: Brand.border,
  );
}
