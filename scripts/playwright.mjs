import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, delimiter, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '0' };
// The managed workspace keeps its .NET SDK beside the project.
const workspaceSDK = resolve(root, '../.dotnet');
if (!env.DOTNET_ROOT && existsSync(resolve(workspaceSDK, 'dotnet'))) {
  env.DOTNET_ROOT = workspaceSDK;
  env.PATH = `${workspaceSDK}${delimiter}${env.PATH || ''}`;
  env.DOTNET_CLI_HOME ||= resolve(root, '.cache/dotnet-home');
  const workspacePackages = resolve(root, '../.cloud-setup/nuget');
  if (existsSync(workspacePackages)) env.NUGET_PACKAGES ||= workspacePackages;
}
const child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: root,
  env,
});
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code) => { process.exitCode = code ?? 1; });
