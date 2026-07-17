// Planning declara el comando de test exacto en un campo "COMANDO_TEST" propio (ver
// src/executor/roles/planning.txt), que ClaudeCodeExecutor adjunta dentro de
// PhaseResult.outputArtifact como { text, comandoTest } cuando está presente — no es parte del
// contrato genérico de Executor, es específico de este pipeline.
export function extractTestCommand(outputArtifact: unknown): string {
  if (
    typeof outputArtifact === "object" &&
    outputArtifact !== null &&
    "comandoTest" in outputArtifact &&
    typeof (outputArtifact as { comandoTest: unknown }).comandoTest === "string"
  ) {
    return (outputArtifact as { comandoTest: string }).comandoTest.trim().replace(/^["'`]|["'`]$/g, "");
  }

  throw new Error(
    `Planning no declaró un COMANDO_TEST parseable. outputArtifact recibido: ${JSON.stringify(outputArtifact).slice(0, 500)}`
  );
}
