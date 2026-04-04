/**
 * Type definitions for E workspace custom tools.
 *
 * Place your custom tool files in `.e/tools/` within your workspace.
 * Each file should export a default object matching the CustomTool interface.
 *
 * Example `.e/tools/deploy.ts`:
 *
 *   const tool: CustomTool = {
 *     name: 'Deploy',
 *     description: 'Deploy the current branch to staging',
 *     parameters: {
 *       environment: {
 *         type: 'string',
 *         description: 'Target environment',
 *         enum: ['staging', 'production'],
 *       },
 *     },
 *     required: ['environment'],
 *     execute: async (input, workspacePath) => {
 *       const { execSync } = require('child_process');
 *       const result = execSync(`./scripts/deploy.sh ${input.environment}`, {
 *         cwd: workspacePath,
 *         encoding: 'utf-8',
 *       });
 *       return { content: result };
 *     },
 *   };
 *   export default tool;
 */

export interface CustomToolResult {
  /** The text content returned to the agent */
  content: string;
  /** If true, the agent sees this as an error result */
  is_error?: boolean;
}

export interface CustomTool {
  /** Tool name — appears in the agent's tool list (e.g. "Deploy", "RunMigration") */
  name: string;
  /** Description shown to the agent — explain what the tool does and when to use it */
  description: string;
  /** Parameter definitions in JSON Schema style */
  parameters: Record<
    string,
    {
      type: 'string' | 'number' | 'boolean' | 'array' | 'object';
      description: string;
      enum?: string[];
      items?: { type: string };
    }
  >;
  /** Which parameters are required */
  required?: string[];
  /**
   * Execute the tool. Receives the agent's input and the workspace path.
   * Return { content: "..." } with the result text.
   * Throw or return { content: "...", is_error: true } on failure.
   */
  execute: (input: Record<string, unknown>, workspacePath: string) => Promise<CustomToolResult>;
}
