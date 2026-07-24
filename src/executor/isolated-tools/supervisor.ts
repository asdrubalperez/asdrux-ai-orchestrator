export interface RuntimeComponent {
  readonly name: string;
  start(signal: AbortSignal): Promise<void>;
  ready(): Promise<void>;
  stop(): Promise<void>;
}

export interface RuntimeHandle {
  readonly signal: AbortSignal;
  readonly components: readonly RuntimeComponent[];
  close(): Promise<void>;
}

export class IsolatedToolsSupervisor {
  async start(factories: readonly (() => RuntimeComponent)[], externalSignal?: AbortSignal): Promise<RuntimeHandle> {
    const controller = new AbortController();
    const onAbort = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener("abort", onAbort, { once: true });
    const components: RuntimeComponent[] = [];
    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      controller.abort(new Error("runtime closed"));
      const failures: Error[] = [];
      for (const component of [...components].reverse()) {
        try { await component.stop(); } catch (error) { failures.push(error as Error); }
      }
      externalSignal?.removeEventListener("abort", onAbort);
      if (failures.length) throw new AggregateError(failures, "Runtime cleanup failed");
    };
    try {
      for (const factory of factories) {
        const component = factory();
        components.push(component);
        await component.start(controller.signal);
        await component.ready();
      }
      return { signal: controller.signal, components, close };
    } catch (error) {
      await close().catch(() => undefined);
      throw new Error(`WORKER_UNAVAILABLE:${(error as Error).message}`);
    }
  }

  async run<T>(factories: readonly (() => RuntimeComponent)[], operation: (runtime: RuntimeHandle) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const runtime = await this.start(factories, signal);
    try { return await operation(runtime); }
    finally { await runtime.close(); }
  }
}
