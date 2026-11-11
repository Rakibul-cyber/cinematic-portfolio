import { createInterface } from "node:readline/promises";

/**
 * Terminal prompts. `askHidden` never echoes what is typed or pasted, and the
 * value exists only in this process's memory: it is not written to a file, an
 * environment variable, the shell history, or any output.
 */

function requireTerminal() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("This needs an interactive terminal. Run it directly in PowerShell, not through a pipe or another tool.");
  }
}

export async function ask(question) {
  requireTerminal();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export function askHidden(question) {
  requireTerminal();
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const finish = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      stdout.write("\n");
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          finish();
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          // Ctrl+C
          finish();
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " ") value += char;
      }
    };
    stdin.on("data", onData);
  });
}
