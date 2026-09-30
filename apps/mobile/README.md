# Omni Mobile (Flutter)

Flutter client for the Omni agent. Created with:

```bash
cd apps/mobile
flutter create omni_mobile --org com.omni.agent --platforms=android,ios
```

Then add the shared app sources under `lib/`. The app talks to the gateway over
WebSocket (`lib/services/websocket_service.dart`) and supports voice notes.

## Build

```bash
cd apps/mobile
flutter pub get
flutter run
```

> Assets referenced by `pubspec.yaml` (`assets/images/`, `assets/sounds/`) must exist
> before `flutter build`; placeholder folders are committed so the paths resolve.
> The custom Roboto font block is only needed if you ship the font files — otherwise
> remove it and Flutter's built-in Roboto is used.
