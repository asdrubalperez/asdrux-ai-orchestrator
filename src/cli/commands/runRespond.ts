import { readValidSession } from "../../auth/session.js";
import { respondToEscalation } from "../respondService.js";

export async function runRespond(args: string[]): Promise<void> {
  const parentRunId = getFlag(args, "--run");
  const solution = getFlag(args, "--solution");
  const abort = args.includes("--abort");

  if (!parentRunId || (abort && solution !== undefined) || (!abort && solution === undefined)) {
    throw new Error('Uso: npm run cli -- run:respond --run <runId> (--solution "<texto>" | --abort)');
  }

  const session = await readValidSession();
  const result = await respondToEscalation({
    parentRunId,
    userId: session.userId,
    action: abort ? { abort: true } : { solution: solution as string },
  });

  if (result.kind === "conflict") {
    throw new Error(`El run ${parentRunId} no está en status escalated.`);
  }

  if (result.kind === "aborted") {
    console.log(`[run:respond] escalamiento abortado para run ${parentRunId}.`);
    return;
  }

  if (result.kind === "project_closed") {
    console.log(`[run:respond] proyecto cerrado — no quedan releases pendientes en el roadmap.`);
    return;
  }

  if (result.kind === "escalation_dead_end") {
    console.log(
      result.reason === "repeated"
        ? `[run:respond] contenido repetido — nadie corrigió el problema original, no se crea otro recorrido.`
        : `[run:respond] tope de 3 recorridos alcanzado sin resolución.`
    );
    return;
  }

  console.log(`[run:respond] run hijo=${result.childRunId}; ejecución iniciada.`);
  await result.execute();
}

function getFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}
