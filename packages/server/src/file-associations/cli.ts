// Headless registrar dispatch (file-type associations + app-launcher entry).
//
// Shared by the dev CLI entry (cli/main.ts, via commander) and the compiled
// binary entry (standalone.ts) so the installer can trigger registration
// without a running server.
import {
  registerFileTypes,
  unregisterFileTypes,
  installAppLauncher,
  uninstallAppLauncher,
  listFileTypes,
} from './registrar';

export type RegistrarCommand =
  | 'register-file-types'
  | 'unregister-file-types'
  | 'install-desktop'
  | 'uninstall-desktop'
  | 'list-file-types';

const COMMANDS: ReadonlySet<string> = new Set<RegistrarCommand>([
  'register-file-types',
  'unregister-file-types',
  'install-desktop',
  'uninstall-desktop',
  'list-file-types',
]);

export function isRegistrarCommand(arg: string | undefined): arg is RegistrarCommand {
  return arg !== undefined && COMMANDS.has(arg);
}

async function runOne(
  cmd: RegistrarCommand,
  args: string[],
): Promise<{ ok: boolean; message: string }> {
  switch (cmd) {
    case 'register-file-types':
      // Extra args are a subset of extensions (e.g. `register-file-types ts py`).
      // None → register all.
      return registerFileTypes(args.length ? args : undefined);
    case 'unregister-file-types':
      return unregisterFileTypes();
    case 'install-desktop':
      return installAppLauncher();
    case 'uninstall-desktop':
      return uninstallAppLauncher();
    default:
      return { ok: false, message: `unknown command: ${cmd}` };
  }
}

/**
 * Runs the given registrar command, prints the result, and exits the process.
 * `args` carries extra tokens — e.g. the extension subset for register-file-types.
 */
export async function runRegistrarCommand(
  cmd: RegistrarCommand,
  args: string[] = [],
): Promise<never> {
  // `list-file-types` prints a machine-readable `<ext>\t<name>` table (consumed
  // by install.sh's "Choose" flow) and exits.
  if (cmd === 'list-file-types') {
    for (const a of listFileTypes()) console.log(`${a.ext}\t${a.name}`);
    process.exit(0);
  }

  const result = await runOne(cmd, args);
  if (result.ok) {
    console.log(result.message);
    process.exit(0);
  }
  console.error(result.message);
  process.exit(1);
}
