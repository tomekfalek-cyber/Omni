# 🤖 Omni Agent

**Samohostujący się, samodoskonalący się agent AI klasy enterprise**

[![CI/CD](https://github.com/tomekfalek-cyber/Omni/actions/workflows/ci.yml/badge.svg)](https://github.com/tomekfalek-cyber/Omni/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Monorepo (**pnpm workspaces + Turborepo**): pakiety TypeScript w `packages/`, aplikacje w `apps/`.

## 🌟 Funkcjonalności

- **Samodoskonalenie** — automatyczne tworzenie i optymalizacja skills (`omni-evolution`)
- **Rój agentów** — Planner, Executor, Reviewer, Evolver (`omni-swarm`)
- **Pamięć** — krótko- i długoterminowa, SQLite + FTS5 (`omni-memory`)
- **Darmowe modele** — Ollama (lokalnie) lub Qwen/OpenRouter (`omni-providers`)
- **Narzędzia** — pliki, shell w sandboxie Dockera, git z approval workflow (`omni-tools`)
- **MCP** — 8 serwerów integracji: Gmail, GitHub, Postgres, Brave, Notion, Linear, Google Drive, Filesystem
- **Kanały** — Telegram, Slack, Discord (`omni-channels`)
- **Głos** — STT Whisper.cpp, TTS XTTS v2 z klonowaniem głosu (`omni-voice`)
- **Bezpieczeństwo** — rate limiting, SecretManager (AES-256), audit log (`omni-gateway`)
- **Observability** — Pino, Prometheus, OpenTelemetry/Jaeger (`omni-observability`)

## 📁 Struktura

```
Omni/
├── apps/
│   ├── mobile/        # Flutter (Android + iOS)
│   ├── desktop/       # Tauri + React
│   └── cli/           # CLI (commander)
├── packages/
│   ├── omni-core/         # typy + approval manager
│   ├── omni-memory/       # SQLite + FTS5
│   ├── omni-providers/    # abstrakcja Qwen / Ollama / OpenRouter
│   ├── omni-tools/        # pliki, shell-sandbox, git
│   ├── omni-swarm/        # Planner / Executor / Reviewer / Evolver
│   ├── omni-channels/     # Telegram / Slack / Discord
│   ├── omni-mcp/          # klienci MCP
│   ├── omni-evolution/    # self-improvement
│   ├── omni-observability/# logi, metryki, tracing
│   ├── omni-voice/        # STT / TTS
│   └── omni-gateway/      # serwer HTTP + WebSocket
├── .omni/             # runtime agenta: agents, skills, policies, memory
├── monitoring/        # Prometheus + Grafana
└── .github/workflows/ # CI/CD
```

## 🚀 Quick Start

**Wymagania:** Node.js 22+, pnpm 8+, Docker (opcjonalnie), Ollama (opcjonalnie).

```bash
git clone https://github.com/tomekfalek-cyber/Omni.git
cd Omni

pnpm install
cp .env.example .env      # ustaw OMNI_AUTH_TOKEN i OMNI_ENCRYPTION_KEY

ollama pull qwen2.5:7b    # opcjonalnie: lokalny, darmowy LLM
pnpm build
pnpm test
pnpm dev                  # uruchom gateway
```

## 🧩 Silniki LLM

| Provider     | Zmienne                              | Koszt                    |
| ------------ | ------------------------------------ | ------------------------ |
| `ollama`     | `OLLAMA_BASE_URL`                     | darmowy, lokalnie        |
| `qwen`       | `QWEN_API_KEY`, `QWEN_BASE_URL`       | DashScope (darmowy tier) |
| `openrouter` | `OPENROUTER_API_KEY` (modele `:free`) | darmowe modele           |

Wybór przez `OMNI_LLM_PROVIDER` (`ollama` | `qwen` | `openrouter`).

## 📜 Licencja

MIT — patrz [LICENSE](LICENSE).

## Instalacja na komputerze i telefonie (jeden link)

**Jeden uniwersalny link instalacyjny:**

https://tomekfalek-cyber.github.io/Omni/

Strona zawiera przycisk **Otwórz Omni**, **kod QR** oraz instrukcje krok po kroku.

### Bezposredni adres Omni (staly)

https://exclude-jaunt-subarctic.ngrok-free.dev

Adres jest **staly** - nie zmienia sie po restarcie komputera (domena zarezerwowana w darmowym planie ngrok).
Przy pierwszym wejsciu w przegladarce pojawi sie strona ostrzezenia ngrok (ograniczenie darmowego planu) - wystarczy kliknac **Visit Site**.

Kod dostepu ustawiasz w panelu (Ustawienia -> Kod dostepu). Telefon pamieta go przez 30 dni.

Gdy komputer jest wylaczony, aplikacja pokazuje ekran "Omni jest teraz wylaczony" (z automatycznym odswiezaniem) zamiast bledu.

### Komputer (Windows / macOS / Linux)
1. Otwórz link w **Chrome**.
2. Menu **⋮** -> **Zainstaluj aplikację**.
3. Ikona **Omni** pojawi się na pulpicie i w menu Start; otwiera się w osobnym oknie (bez paska przeglądarki).

### Telefon (Android / iPhone)
1. Otwórz link **w przeglądarce** (Chrome na Androidzie, Safari na iPhone) - nie w aplikacji GitHub/WhatsApp.
2. Kliknij **Otwórz Omni** i wpisz **kod dostępu** (Ustawienia -> Kod dostępu w panelu).
3. **Android:** menu **⋮** -> *Zainstaluj aplikację* lub *Dodaj do ekranu głównego*.**iPhone:** *Udostępnij* -> *Dodaj do ekranu głównego*.
4. Ikona Omni działa jak zwykła aplikacja (pełny ekran, bez paska adresu).

> Uwaga: strona nie może zainstalować się samodzielnie - przeglądarka wymaga jednego dotknięcia (zabezpieczenie).

### Telefon i komputer = jedna wspólna rozmowa
Oba urządzenia łączą się z tym samym serwerem Omni, więc historia czatu jest wspólna i synchronizuje się na żywo.
Aktualny adres serwera znajdziesz w panelu: **Status -> Adres dla telefonu**.

### Kod dostępu
Panel jest chroniony kodem (chroni przed dostępem z internetu). Ustawiasz go w **Ustawienia -> Kod dostępu**.
Telefon zapamiętuje kod na 30 dni.
