/**
 * DAP client store — Debug Adapter Protocol over WebSocket.
 *
 * Connects to `/api/dap/ws?adapter=X&sessionId=Y`. One store instance covers one
 * session at a time (v1 scope). The DAP spec's state machine is surprisingly
 * small for the basic flow we need:
 *
 *   initialize → launch → (events: initialized, stopped, thread, output, …)
 *   setBreakpoints whenever user toggles one
 *   continue / next / stepIn / stepOut
 *   threads → stackTrace → scopes → variables
 *   disconnect / terminated
 */

import { getDirectWsBase } from '$lib/api/client';
import { breakpointsStore } from './breakpoints.svelte';

export type DebugState =
  | 'idle'
  | 'connecting'
  | 'initializing'
  | 'running'
  | 'stopped'
  | 'terminated'
  | 'error';

export interface StackFrame {
  id: number;
  name: string;
  source?: { path?: string; name?: string };
  line: number;
  column: number;
}

export interface DebugThread {
  id: number;
  name: string;
}

export interface Scope {
  name: string;
  variablesReference: number;
  expensive?: boolean;
}

export interface Variable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
}

/** Output events from the adapter (stdout/stderr/telemetry/…). */
export interface OutputEvent {
  category: string;
  output: string;
  timestamp: number;
}

interface PendingRequest {
  resolve: (val: any) => void;
  reject: (err: any) => void;
  command: string;
}

function createDapStore() {
  let ws: WebSocket | null = null;
  let state = $state<DebugState>('idle');
  let adapter = $state<string | null>(null);
  let sessionId = $state<string | null>(null);
  let errorMessage = $state<string | null>(null);

  let threads = $state<DebugThread[]>([]);
  let currentThreadId = $state<number | null>(null);
  let stackFrames = $state<StackFrame[]>([]);
  let currentFrameId = $state<number | null>(null);
  let scopes = $state<Scope[]>([]);
  /** Variable children cache — keyed by DAP variablesReference. */
  let variablesByRef = $state<Map<number, Variable[]>>(new Map());
  let output = $state<OutputEvent[]>([]);
  const MAX_OUTPUT = 500;

  let seq = 1;
  const pending = new Map<number, PendingRequest>();

  function send(msg: any) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(msg));
  }

  function request<T = any>(command: string, args?: any): Promise<T> {
    const reqSeq = seq++;
    send({ seq: reqSeq, type: 'request', command, arguments: args ?? {} });
    return new Promise<T>((resolve, reject) => {
      pending.set(reqSeq, { resolve, reject, command });
      // Timeout safety — most DAP calls complete in well under a second, but
      // `launch` can be slow on cold starts. 20s covers the common cases.
      setTimeout(() => {
        if (pending.has(reqSeq)) {
          pending.delete(reqSeq);
          reject(new Error(`DAP request timed out: ${command}`));
        }
      }, 20_000);
    });
  }

  function handleMessage(msg: any) {
    if (msg.type === 'response') {
      const p = pending.get(msg.request_seq);
      if (!p) return;
      pending.delete(msg.request_seq);
      if (msg.success) p.resolve(msg.body);
      else p.reject(new Error(msg.message || `DAP ${p.command} failed`));
      return;
    }

    if (msg.type === 'event') {
      handleEvent(msg);
      return;
    }

    // Gateway envelope messages from our server (not DAP itself).
    if (msg.type === 'ready') {
      sessionId = msg.sessionId;
      adapter = msg.adapter;
      return;
    }
    if (msg.type === 'error') {
      errorMessage = msg.error;
      state = 'error';
      return;
    }
  }

  function handleEvent(msg: any) {
    switch (msg.event) {
      case 'initialized':
        // Adapter is ready for breakpoint configuration + configurationDone.
        void syncAllBreakpointsToAdapter().then(() => {
          request('configurationDone').catch(() => {});
          state = 'running';
        });
        break;

      case 'stopped':
        state = 'stopped';
        currentThreadId = msg.body?.threadId ?? currentThreadId;
        void refreshStackTrace();
        break;

      case 'continued':
        state = 'running';
        stackFrames = [];
        scopes = [];
        variablesByRef = new Map();
        break;

      case 'thread':
        // Threads start/exit — refresh the list lazily.
        void request('threads')
          .then((res: any) => {
            if (res?.threads) threads = res.threads;
          })
          .catch(() => {});
        break;

      case 'output': {
        const o: OutputEvent = {
          category: msg.body?.category ?? 'console',
          output: msg.body?.output ?? '',
          timestamp: Date.now(),
        };
        output = [...output.slice(-MAX_OUTPUT + 1), o];
        break;
      }

      case 'terminated':
      case 'exited':
        state = 'terminated';
        break;

      case 'breakpoint':
        // Adapter confirming/verifying a breakpoint — mirror the `verified` flag.
        if (msg.body?.breakpoint) {
          const bp = msg.body.breakpoint;
          const path = bp.source?.path;
          if (path && bp.line != null) {
            breakpointsStore.setVerified(path, bp.line, !!bp.verified);
          }
        }
        break;
    }
  }

  async function refreshStackTrace() {
    if (currentThreadId == null) return;
    try {
      const res: any = await request('stackTrace', { threadId: currentThreadId, levels: 20 });
      stackFrames = res?.stackFrames ?? [];
      if (stackFrames.length > 0) {
        currentFrameId = stackFrames[0].id;
        await refreshScopes(stackFrames[0].id);
      }
    } catch {
      // non-fatal — UI just shows empty stack
    }
  }

  async function refreshScopes(frameId: number) {
    try {
      const res: any = await request('scopes', { frameId });
      scopes = res?.scopes ?? [];
      // Prefetch locals for immediate display — other scopes are lazy.
      const locals = scopes.find((s) => /local/i.test(s.name));
      if (locals) await loadVariables(locals.variablesReference);
    } catch {}
  }

  async function loadVariables(ref: number): Promise<Variable[]> {
    if (variablesByRef.has(ref)) return variablesByRef.get(ref)!;
    try {
      const res: any = await request('variables', { variablesReference: ref });
      const vars: Variable[] = res?.variables ?? [];
      const next = new Map(variablesByRef);
      next.set(ref, vars);
      variablesByRef = next;
      return vars;
    } catch {
      return [];
    }
  }

  async function syncAllBreakpointsToAdapter(): Promise<void> {
    for (const [path, bps] of breakpointsStore.byPath.entries()) {
      await setBreakpointsForFile(
        path,
        bps.filter((b) => b.enabled),
      ).catch(() => {});
    }
  }

  async function setBreakpointsForFile(path: string, bps: { line: number; condition?: string }[]) {
    if (state !== 'running' && state !== 'stopped' && state !== 'initializing') return;
    await request('setBreakpoints', {
      source: { path, name: path.split('/').pop() },
      breakpoints: bps.map((b) => ({ line: b.line, condition: b.condition || undefined })),
      sourceModified: false,
    });
  }

  return {
    get state() {
      return state;
    },
    get adapter() {
      return adapter;
    },
    get sessionId() {
      return sessionId;
    },
    get threads() {
      return threads;
    },
    get currentThreadId() {
      return currentThreadId;
    },
    get stackFrames() {
      return stackFrames;
    },
    get currentFrameId() {
      return currentFrameId;
    },
    get scopes() {
      return scopes;
    },
    get variablesByRef() {
      return variablesByRef;
    },
    get output() {
      return output;
    },
    get errorMessage() {
      return errorMessage;
    },
    get isActive() {
      return state === 'running' || state === 'stopped' || state === 'initializing';
    },

    /**
     * Start a new debug session.
     * `launchArgs` are adapter-specific (e.g. debugpy takes { program, args, cwd }).
     */
    async start(opts: { adapter: string; cwd?: string; launchArgs: any }): Promise<void> {
      if (this.isActive) {
        throw new Error('A debug session is already running — stop it first.');
      }
      errorMessage = null;
      output = [];
      stackFrames = [];
      scopes = [];
      variablesByRef = new Map();
      threads = [];
      state = 'connecting';

      const url = `${getDirectWsBase()}/dap/ws?adapter=${encodeURIComponent(opts.adapter)}${
        opts.cwd ? `&cwd=${encodeURIComponent(opts.cwd)}` : ''
      }`;
      ws = new WebSocket(url);

      await new Promise<void>((resolve, reject) => {
        if (!ws) return reject(new Error('WebSocket init failed'));
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error('DAP WebSocket error'));
        ws.onclose = () => {
          if (state === 'connecting') reject(new Error('DAP WebSocket closed before ready'));
        };
        ws.onmessage = (event) => {
          try {
            handleMessage(JSON.parse(String(event.data)));
          } catch {}
        };
      });

      state = 'initializing';

      // Initialize handshake — capabilities negotiation.
      await request('initialize', {
        clientID: 'e',
        clientName: 'E',
        adapterID: opts.adapter,
        pathFormat: 'path',
        linesStartAt1: true,
        columnsStartAt1: true,
        supportsVariableType: true,
        supportsRunInTerminalRequest: false,
        locale: 'en',
      });

      // Launch — adapter-specific payload.
      await request('launch', opts.launchArgs);

      // The adapter will now emit `initialized`; our event handler takes over
      // from there (sync breakpoints, configurationDone, flip to running).
    },

    async continueExec(): Promise<void> {
      if (currentThreadId == null) return;
      await request('continue', { threadId: currentThreadId });
    },
    async pause(): Promise<void> {
      if (currentThreadId == null) return;
      await request('pause', { threadId: currentThreadId }).catch(() => {});
    },
    async stepOver(): Promise<void> {
      if (currentThreadId == null) return;
      await request('next', { threadId: currentThreadId });
    },
    async stepIn(): Promise<void> {
      if (currentThreadId == null) return;
      await request('stepIn', { threadId: currentThreadId });
    },
    async stepOut(): Promise<void> {
      if (currentThreadId == null) return;
      await request('stepOut', { threadId: currentThreadId });
    },
    async stop(): Promise<void> {
      try {
        await request('disconnect', { terminateDebuggee: true });
      } catch {
        // Some adapters reject disconnect once the debuggee has already exited;
        // that's fine, fall through to socket close.
      }
      ws?.close();
      ws = null;
      state = 'idle';
      sessionId = null;
      adapter = null;
    },

    /** Push current breakpoints for a single file to the adapter (no-op if idle). */
    async pushBreakpointsFor(path: string): Promise<void> {
      if (!this.isActive) return;
      const bps = breakpointsStore.forFile(path).filter((b) => b.enabled);
      await setBreakpointsForFile(path, bps);
    },

    /** Drill into a variable's children (for the tree view). */
    loadVariables,

    /** Change which frame is focused — re-fetches scopes for that frame. */
    async selectFrame(frameId: number): Promise<void> {
      currentFrameId = frameId;
      scopes = [];
      variablesByRef = new Map();
      await refreshScopes(frameId);
    },
  };
}

export const dapStore = createDapStore();
