import * as readline from 'readline';
import { Command } from 'commander';
import { ToolRegistry } from 'omni-tools/registry.js';

const program = new Command();

program
  .name('omni')
  .description('Omni Agent CLI')
  .version('1.0.0');

const tools = new ToolRegistry();

program
  .command('tools')
  .description('Lista dostępnych narzędzi')
  .action(() => {
    for (const def of tools.getAllDefinitions()) {
      console.log(`- ${def.name}: ${def.description}`);
    }
  });

program
  .command('chat')
  .description('Interaktywny czat z agentem (z mostkiem zatwierdzeń)')
  .action(() => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    // Mostek zatwierdzeń: ApprovalManager emituje 'approval_required', CLI odpowiada.
    tools.approvalManager.on('approval_required', (data: any) => {
      console.log('\n⚠️  [ZATWIERDZENIE WYMAGANE]');
      console.log(`Narzędzie: ${data.toolName}`);
      console.log(`Argumenty: ${JSON.stringify(data.args, null, 2)}`);

      rl.question('Czy zezwolić na wykonanie? (t/n): ', (answer) => {
        const approved = ['t', 'tak', 'y', 'yes'].includes(answer.trim().toLowerCase());
        const manager = tools.approvalManager as any;
        if (typeof manager.respondToApproval === 'function') {
          manager.respondToApproval(data.callId, approved);
        } else if (typeof data.respond === 'function') {
          data.respond(approved);
        }
        console.log(approved ? '✅ Zatwierdzono.' : '❌ Odrzucono.');
      });
    });

    console.log('Omni CLI — wpisz "exit", aby wyjść.');
    rl.on('line', (line) => {
      if (line.trim() === 'exit') {
        rl.close();
        process.exit(0);
      }
    });
  });

program.parse(process.argv);
