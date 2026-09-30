import * as readline from 'readline';
import { ToolRegistry } from 'omni-tools/registry.js';

// ... wewnątrz komendy chat lub jako globalny nasłuch ...
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// Nasłuchiwanie zdarzeń z ToolRegistry (zakładając, że masz do niego dostęp w CLI)
// W pełnej architekturze: Gateway przesyła to przez WebSocket do CLI
agent.tools.approvalManager.on('approval_required', (data: any) => {
  console.log(`\n⚠️  [ZATWIERDZENIE WYMAGANE]`);
  console.log(`Narzędzie: ${data.toolName}`);
  console.log(`Argumenty: ${JSON.stringify(data.args, null, 2)}`);
  
  rl.question('Czy zezwolić na wykonanie? (t/n): ', (answer) => {
    const approved = answer.toLowerCase() === 't' || answer.toLowerCase() === 'tak';
    agent.tools.approvalManager.respondToApproval(data.callId, approved);
    console.log(approved ? '✅ Zatwierdzono.' : '❌ Odrzucono.');
  });
});
