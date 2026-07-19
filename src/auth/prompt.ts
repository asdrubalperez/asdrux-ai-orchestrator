import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function promptLine(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}

export async function promptHiddenLine(prompt: string): Promise<string> {
  if (!input.isTTY || !output.isTTY) {
    throw new Error("Este comando requiere una terminal interactiva para ingresar la contraseña.");
  }

  return new Promise((resolve, reject) => {
    let value = "";

    const cleanup = () => {
      input.setRawMode(false);
      input.pause();
      input.removeListener("data", onData);
    };

    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");

      if (text === "\u0003") {
        cleanup();
        output.write("\n");
        reject(new Error("Entrada cancelada."));
        return;
      }

      if (text === "\r" || text === "\n" || text === "\r\n") {
        cleanup();
        output.write("\n");
        resolve(value);
        return;
      }

      if (text === "\u0008" || text === "\u007f") {
        value = value.slice(0, -1);
        return;
      }

      value += text;
    };

    output.write(prompt);
    input.setEncoding("utf8");
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}
