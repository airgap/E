// Headless `register-file-types` / `unregister-file-types` dispatch.
//
// Shared by the dev CLI entry (cli/main.ts, via commander) and the compiled
// binary entry (standalone.ts) so the installer can trigger registration
// without a running server.
import { registerFileTypes, unregisterFileTypes } from './registrar';

export type FileTypesCommand = 'register-file-types' | 'unregister-file-types';

export function isFileTypesCommand(arg: string | undefined): arg is FileTypesCommand {
  return arg === 'register-file-types' || arg === 'unregister-file-types';
}

/** Runs the given file-types command, prints the result, and exits the process. */
export async function runFileTypesCommand(cmd: FileTypesCommand): Promise<never> {
  const result =
    cmd === 'register-file-types' ? await registerFileTypes() : await unregisterFileTypes();
  if (result.ok) {
    console.log(result.message);
    process.exit(0);
  }
  console.error(result.message);
  process.exit(1);
}
