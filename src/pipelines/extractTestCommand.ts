// Planning declara el comando de test exacto como "COMANDO_TEST" (ver
// src/executor/roles/planning.txt). ClaudeCodeExecutor lo adjunta como { text, comandoTest };
// CodexExecutor lo conserva dentro del artifact textual devuelto por --output-schema.
export function extractTestCommand(outputArtifact: unknown): string {
  if (
    typeof outputArtifact === "object" &&
    outputArtifact !== null &&
    "comandoTest" in outputArtifact &&
    typeof (outputArtifact as { comandoTest: unknown }).comandoTest === "string"
  ) {
    return normalizeTestCommand((outputArtifact as { comandoTest: string }).comandoTest);
  }

  if (typeof outputArtifact === "string") {
    const match = outputArtifact.match(/^COMANDO_TEST:\s*(.+)$/m);
    if (match) {
      return normalizeTestCommand(match[1]);
    }
  }

  throw new Error(
    `Planning no declaro un COMANDO_TEST parseable. outputArtifact recibido: ${JSON.stringify(outputArtifact).slice(0, 500)}`
  );
}

function normalizeTestCommand(command: string): string {
  return command.trim().replace(/^["'`]|["'`]$/g, "");
}
