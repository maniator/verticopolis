// How the MCP launchers start their server. Only a bare command name (npx,
// which is a .cmd script on Windows) needs a shell, because Node refuses to
// spawn a .cmd file without one. The shell joins arguments with spaces and no
// quoting, so on Windows each argument that holds a space, a quote or a cmd
// metacharacter (& | < > ^ and parentheses, all literal inside quotes) is
// quoted first; C:\Program Files\nodejs\node.exe or C:\R&D\chrome.exe then
// stays one argument. A command given as a path (process.execPath) runs directly.
export function spawnPlan(command, args, platform = process.platform) {
  const shell = platform === "win32" && !/[\\/]/.test(command);
  if (!shell) return { command, args, shell: false };
  const quote = (arg) => (/[\s"&|<>^()]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);
  return { command, args: args.map(quote), shell: true };
}
