// generate-scaffold.js
const fs = require('fs');
const path = require('path');

const structure = {
  'apps/cli/src/index.ts': '// Omni CLI Entry Point\nimport { Command } from "commander";\n// ... (pełny kod CLI z Części 1)',
  'apps/desktop/src-tauri/Cargo.toml': '[package]\nname = "omni-desktop"\nversion = "1.0.0"\nedition = "2021"\n\n[dependencies]\ntauri = "1.5"\nserde = { version = "1.0", features = ["derive"] }',
  'apps/desktop/src-tauri/src/main.rs': '#[tauri::main]\nasync fn main() {\n    tauri::Builder::default()\n        .run(tauri::generate_context!())\n        .expect("error while running tauri application");\n}',
  'apps/mobile/lib/main.dart': 'import \'package:flutter/material.dart\';\n\nvoid main() => runApp(const OmniApp());\n\nclass OmniApp extends StatelessWidget {\n  const OmniApp({Key? key}) : super(key: key);\n  @override\n  Widget build(BuildContext context) {\n    return MaterialApp(title: \'Omni Mobile\', theme: ThemeData.dark(), home: Scaffold(appBar: AppBar(title: Text(\'Omni\'))));\n  }\n}',
  'packages/omni-core/src/index.ts': 'export * from \'./types.js\';\nexport * from \'./agent-loop.js\';',
  'packages/omni-memory/src/memory.ts': '// ... (kod z Części 1)',
  'packages/omni-tools/src/index.ts': 'export * from \'./registry.js\';',
  'packages/omni-providers/src/index.ts': 'export * from \'./qwen-provider.js\';',
  'packages/omni-swarm/src/index.ts': 'export * from \'./swarm-manager.js\';',
  'packages/omni-gateway/src/index.ts': 'export * from \'./server.js\';',
  'tools/sandbox/Dockerfile': 'FROM node:22-alpine\nRUN apk add --no-cache git python3 make g++\nWORKDIR /app\nCOPY . .\nRUN npm install\nCMD ["node", "index.js"]',
  'docker-compose.yml': 'version: \'3.8\'\nservices:\n  ollama:\n    image: ollama/ollama:latest\n    ports:\n      - "11434:11434"\n    volumes:\n      - ollama_data:/root/.ollama\n  gateway:\n    build: .\n    ports:\n      - "7800:7800"\n    environment:\n      - OMNI_LLM_PROVIDER=ollama\n      - OLLAMA_BASE_URL=http://ollama:11434/v1\n    depends_on:\n      - ollama\nvolumes:\n  ollama_data:',
  '.github/workflows/ci.yml': 'name: CI\non: [push, pull_request]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v3\n      - uses: pnpm/action-setup@v2\n      - run: pnpm install\n      - run: pnpm run build\n      - run: pnpm run test',
  'turbo.json': '{\n  "$schema": "https://turbo.build/schema.json",\n  "pipeline": {\n    "build": {\n      "dependsOn": ["^build"],\n      "outputs": ["dist/**"]\n    },\n    "test": {\n      "dependsOn": ["build"]\n    }\n  }\n}',
  'package.json': '{\n  "name": "omni-agent-monorepo",\n  "version": "1.0.0",\n  "private": true,\n  "scripts": {\n    "build": "turbo run build",\n    "dev": "turbo run dev",\n    "test": "turbo run test",\n    "lint": "turbo run lint"\n  },\n  "devDependencies": {\n    "turbo": "latest",\n    "typescript": "^5.3.3"\n  }\n}'
};

function createFiles(baseDir = '.') {
  for (const [filePath, content] of Object.entries(structure)) {
    const fullPath = path.join(baseDir, filePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content.trim());
    console.log(`✅ Utworzono: ${filePath}`);
  }
  console.log('\n🎉 Szkielet wygenerowany! Uruchom: pnpm install && pnpm run build');
}

createFiles();
