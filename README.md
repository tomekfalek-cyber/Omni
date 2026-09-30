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
