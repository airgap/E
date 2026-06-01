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
} from './registrar';

export type RegistrarCommand =
  | 'register-file-types'
  | 'unregister-file-types'
  | 'install-desktop'
  | 'uninstall-desktop';

const RUNNERS: Record<RegistrarCommand, () => Promise<{ ok: boolean; message: string }>> = {
  'register-file-types': registerFileTypes,
  'unregister-file-types': unregisterFileTypes,
  'install-desktop': installAppLauncher,
  'uninstall-desktop': uninstallAppLauncher,
};

export function isRegistrarCommand(arg: string | undefined): arg is RegistrarCommand {
  return arg !== undefined && arg in RUNNERS;
}

/** Runs the given registrar command, prints the result, and exits the process. */
export async function runRegistrarCommand(cmd: RegistrarCommand): Promise<never> {
  const result = await RUNNERS[cmd]();
  if (result.ok) {
    console.log(result.message);
    process.exit(0);
  }
  console.error(result.message);
  process.exit(1);
}
