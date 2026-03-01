/**
 * E CLI — Link Command
 *
 * Persistently links this CLI session to a running E server instance
 * via WebSockets for shared state and remote control.
 */

import { theme } from '../ui/theme';

export async function runLink(opts: { serverUrl?: string; sessionId: string }) {
  const url = opts.serverUrl || 'ws://localhost:3002/api/agents/ws/' + opts.sessionId;

  console.log(`${theme.brand('E')} ${theme.system(`Linking to ${url}…`)}`);

  const ws = new WebSocket(url);

  ws.onopen = () => {
    console.log(`${theme.success('Linked to E Server')}`);
    console.log(`${theme.system('State is now synchronized with the GUI.')}\n`);
  };

  ws.onmessage = async (event) => {
    const data = JSON.parse(String(event.data));

    if (data.type === 'init') {
      console.log(`${theme.system(`Session context: ${data.sessionId}`)}`);
    }

    if (data.type === 'prompt') {
      console.log(`\n${theme.user('E-Server')} ${data.content}`);
      // The linked agent (this CLI) could now execute the prompt locally...
    }

    if (data.type === 'delta') {
      process.stdout.write(data.delta);
    }

    if (data.type === 'tool_call') {
      console.log(`\n\n${theme.toolHeader(data.tool.name)}`);
      console.log(theme.toolInput(JSON.stringify(data.tool.input, null, 2)));
    }

    if (data.type === 'stop') {
      console.log(`\n${theme.system('Turn complete.')}`);
    }

    if (data.type === 'error') {
      console.log(`\n${theme.error(data.message)}`);
    }
  };

  ws.onclose = () => {
    console.log(`\n${theme.warning('Disconnected from E Server.')}`);
    process.exit(0);
  };

  ws.onerror = (err) => {
    const message = (err as any).message || 'Unknown WebSocket error';
    console.error(`\n${theme.error('Connection failed: ' + message)}`);
    process.exit(1);
  };

  // Keep alive
  process.stdin.resume();
}
