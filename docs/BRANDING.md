# Branding — Omni „Granat"

Ultranowoczesny, ciemnoniebieski motyw spójny między logo, tłem i ikonami aplikacji.

## Paleta

| Rola            | HEX       | Użycie                                  |
| --------------- | --------- | --------------------------------------- |
| Granat (tło)    | `#0A1128` | tło aplikacji, motyw                    |
| Głębia          | `#05091A` | sidebar, dolna belka, winieta           |
| Akcent          | `#3D7BFD` | przyciski, aktywne elementy, poświata   |
| Poświata        | `#7FD8FF` | akcenty, węzły obwodów, podświetlenia   |
| Tekst           | `#E6EDF7` | tekst podstawowy                        |

Tło logo zostało zmierzone bezpośrednio z załączonego obrazu: **`#091226`**
(dominanta `rgb(8, 24, 40)`), więc tła aplikacji są dopasowane 1:1.

## Assety

| Plik | Przeznaczenie |
| --- | --- |
| `apps/mobile/assets/icon/icon.png` | źródło ikony (1024²) |
| `apps/mobile/assets/icon/icon_foreground.png` | warstwa foreground (adaptive icon, Android) |
| `apps/mobile/assets/images/logo.png` | logo w UI (512²) |
| `apps/mobile/assets/images/background.png` | tło mobile (1080×2400) |
| `apps/mobile/android/app/src/main/res/mipmap-*/ic_launcher.png` | ikona Android (5 gęstości) |
| `apps/mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset/*` | ikona iOS (pełny zestaw) |
| `apps/desktop/public/logo.png·background.png·favicon.png·favicon.ico` | UI + favicon desktopu |
| `apps/desktop/src-tauri/icons/*` | ikony aplikacji desktop (PNG/ICO/ICNS) |

## Regeneracja ikon

Ikony są już wygenerowane i zacommitowane. Po zmianie źródła:

```bash
# Flutter (Android + iOS) — konfiguracja w apps/mobile/pubspec.yaml
cd apps/mobile && dart run flutter_launcher_icons

# Desktop/Tauri — z PNG 1024×1024
cd apps/desktop && npx @tauri-apps/cli icon src-tauri/icons/icon.png
```
