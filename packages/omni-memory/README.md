# omni-memory

Short- and long-term memory for the Omni agent, backed by **SQLite** with full-text
search via **FTS5** (external-content table + triggers, so the index stays in sync).

## Usage

```ts
import { MemoryStore } from 'omni-memory';

const memory = new MemoryStore('./.omni/memory/omni.db');

memory.add({ sessionId: 'default', role: 'user', content: 'Cześć Omni' });
memory.add({ sessionId: 'default', role: 'assistant', content: 'Cześć!' });

const hits = memory.search('Omni', 10);
const recent = memory.recent('default', 20);
memory.close();
```

Pass `:memory:` (the default) for an ephemeral in-process database — handy in tests.

> `better-sqlite3` ships a native binding; it compiles on install (needs a C toolchain)
> or downloads a prebuilt binary for your platform.
