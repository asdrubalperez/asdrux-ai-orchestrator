import { ChildProcess, spawn } from "node:child_process";
import { RuntimeComponent } from "./supervisor.js";

export interface ProcessComponentOptions {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  env: NodeJS.ProcessEnv;
  readinessMarker: string;
  readinessTimeoutMs?: number;
}

export class ProcessRuntimeComponent implements RuntimeComponent {
  readonly name: string;
  #child?: ChildProcess;
  #ready?: Promise<void>;
  #resolveReady?: () => void;
  #rejectReady?: (error: Error) => void;
  readonly output: string[] = [];

  constructor(private readonly options: ProcessComponentOptions) {
    this.name = options.name;
  }

  async start(signal: AbortSignal): Promise<void> {
    if (this.#child) throw new Error(`${this.name} already started`);
    this.#ready = new Promise<void>((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });
    this.#child = spawn(this.options.command, this.options.args, {
      cwd: this.options.cwd,
      env: this.options.env,
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });
    let stdoutBuffer = "";
    this.#child.stdout?.on("data", (chunk) => {
      stdoutBuffer += String(chunk);
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        this.output.push(line);
        if (line.includes(this.options.readinessMarker)) this.#resolveReady?.();
      }
    });
    this.#child.stderr?.on("data", (chunk) => this.output.push(`stderr:${String(chunk).trim()}`));
    this.#child.once("error", (error) => this.#rejectReady?.(error));
    this.#child.once("exit", (code) => {
      if (!this.output.some((line) => line.includes(this.options.readinessMarker))) {
        this.#rejectReady?.(new Error(`${this.name} exited before readiness: ${code}`));
      }
    });
  }

  async ready(): Promise<void> {
    if (!this.#ready) throw new Error(`${this.name} not started`);
    const timeoutMs = this.options.readinessTimeoutMs ?? 5_000;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.#ready,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${this.name} readiness timeout`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async stop(): Promise<void> {
    const child = this.#child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => child.kill("SIGKILL"), 2_000);
      child.once("exit", () => { clearTimeout(force); resolve(); });
      child.kill("SIGTERM");
    });
  }
}
