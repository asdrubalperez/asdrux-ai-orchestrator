import { getRunDetail } from "../../db/repository.js";

export async function runStatus(args: string[]): Promise<void> {
  const runId = getFlag(args, "--run");
  if (!runId) {
    throw new Error("Uso: npm run cli -- run:status --run <runId>");
  }

  const detail = await getRunDetail(runId);
  if (!detail) {
    console.log(`No existe ningún run con id ${runId}`);
    return;
  }

  console.log(JSON.stringify(detail, null, 2));
}

function getFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}
