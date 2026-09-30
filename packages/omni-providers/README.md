# omni-providers

Provider abstraction for Omni LLM backends. Ships a free-first default set:

| id         | backend                                   | auth                     |
| ---------- | ----------------------------------------- | ------------------------ |
| `ollama`   | local Ollama daemon                        | none (local, free)       |
| `qwen`     | Alibaba Qwen / DashScope (OpenAI-compat)   | `QWEN_API_KEY`           |
| `openrouter` | OpenRouter, free models (`:free` suffix) | `OPENROUTER_API_KEY`     |

```ts
import { createProvider } from 'omni-providers';

const llm = createProvider('ollama', { model: 'qwen2.5:7b' });
const reply = await llm.chat({
  messages: [{ role: 'user', content: 'Cześć Omni!' }],
});
console.log(reply.content);
```

Every provider implements the same `LLMProvider` interface, so swapping Ollama for
OpenRouter (or DashScope) is a one-line change.
