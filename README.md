# 🤖 Omni Agent

**Samohostujący się, samodoskonalący się agent AI klasy enterprise**

[![CI/CD](https://github.com/yourusername/omni-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/yourusername/omni-agent/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/yourusername/omni-agent/branch/main/graph/badge.svg)](https://codecov.io/gh/yourusername/omni-agent)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 🌟 Funkcjonalności

### 🧠 Inteligentny Agent
- **Samodoskonalenie**: Automatyczne tworzenie i optymalizacja skills
- **Rój agentów**: Planner, Executor, Reviewer, Evolver
- **Pamięć**: Krótko- i długoterminowa z SQLite + FTS5
- **Darmowe modele Qwen**: Ollama (lokalnie) lub OpenRouter (cloud)

### 🛠️ Narzędzia
- **Pliki**: Czytanie, pisanie, listowanie z zabezpieczeniami
- **Shell**: Docker Sandbox z izolacją sieciową
- **Git**: Status, diff, commit z approval workflow
- **MCP**: 8 serwerów integracji (Gmail, GitHub, Postgres, Brave, Notion, Linear, Google Drive, Filesystem)

### 💬 Kanały Komunikacji
- **Telegram**: Inline keyboards dla approval
- **Slack**: Block Kit, Socket Mode
- **Discord**: Slash commands, message components
- **Desktop**: Tauri + React z streamingiem
- **Mobile**: Flutter z nagrywaniem głosu

### 🎤 Głos
- **STT**: Whisper.cpp (lokalnie) lub OpenAI Whisper
- **TTS**: XTTS v2 z klonowaniem głosu
- **Klonowanie**: 6-30 sekund próbki audio

### 🔒 Bezpieczeństwo
- **Rate limiting**: Per user/tool/model
- **Szyfrowanie**: SecretManager z AES-256
- **Audit log**: Pełna historia akcji
- **Docker Sandbox**: Izolacja sieciowa, limity CPU/RAM
- **Path traversal protection**: Walidacja ścieżek

### 📊 Observability
- **Structured logging**: Pino (JSON + pretty)
- **Prometheus metrics**: Tasks, tools, LLM, sessions
- **OpenTelemetry tracing**: Pełny tracing z Jaeger
- **Grafana dashboards**: Wizualizacja metryk

### 🔄 CI/CD
- **GitHub Actions**: Lint, test, build, security audit
- **Docker**: Automatyczny build i push
- **Backup**: Automatyczny co 24h z retencją 10 backupów

## 🚀 Quick Start

### Wymagania
- Node.js 22+
- pnpm 8+
- Docker & Docker Compose
- Ollama (opcjonalnie, dla lokalnego LLM)

### Instalacja

```bash
# Klonuj repozytorium
git clone https://github.com/yourusername/omni-agent.git
cd omni-agent

# Zainstaluj zależności
pnpm install

# Skopiuj .env
cp .env.example .env

# Edytuj .env (ustaw OMNI_AUTH_TOKEN, OMNI_ENCRYPTION_KEY)
nano .env

# Uruchom Ollama i pobierz model Qwen
ollama pull qwen2.5:7b

# Zbuduj projekt
pnpm build

# Uruchom gateway
pnpm dev
