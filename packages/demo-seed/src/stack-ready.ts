import type { SeedConfig } from './config.js';

/** A service and the base URL its `/health/ready` is under. */
export interface ReadyTarget {
  name: string;
  url: string;
}

/** Every service a beat may reach, directly or through the events and workflows it starts. */
export function serviceTargets(config: SeedConfig): ReadyTarget[] {
  return [
    { name: 'directory', url: config.DIRECTORY_URL },
    { name: 'declarations', url: config.DECLARATIONS_URL },
    { name: 'review', url: config.REVIEW_URL },
    { name: 'access', url: config.ACCESS_URL },
    { name: 'reporting', url: config.REPORTING_URL },
    { name: 'documents', url: config.DOCUMENTS_URL },
    { name: 'verification-api', url: config.VERIFICATION_API_URL },
    { name: 'ai-gateway', url: config.AI_GATEWAY_URL },
    { name: 'integration-gateway', url: config.INTEGRATION_GATEWAY_URL },
    { name: 'notifications', url: config.NOTIFICATIONS_URL },
    { name: 'audit', url: config.AUDIT_URL },
  ];
}

export interface WaitOptions {
  /** How long the services get to be ready again. Default 3 minutes. */
  timeoutMs?: number;
  /**
   * How long a service may refuse connections before it counts as dead, without waiting out
   * `timeoutMs`: a dev watcher restarts a service in seconds, a crashed one never comes back.
   * Default 30 s.
   */
  refusedTimeoutMs?: number;
  intervalMs?: number;
  log?: (line: string) => void;
}

interface Probe {
  target: ReadyTarget;
  ready: boolean;
  refused: boolean;
  reason: string;
}

/**
 * Waits until every service answers its readiness check, so a beat does not start on a stack
 * still recovering from a checkpoint's freeze (#636). Fails naming each service that is not
 * ready by the deadline and why: not running (connection refused) or the dependencies it reports
 * down.
 */
export async function waitForServicesReady(
  targets: readonly ReadyTarget[],
  {
    timeoutMs = 180_000,
    refusedTimeoutMs = 30_000,
    intervalMs = 1000,
    log = () => undefined,
  }: WaitOptions = {},
): Promise<void> {
  const started = Date.now();
  /** When each service first refused a connection, while it keeps refusing. */
  const refusedSince = new Map<string, number>();
  let waiting = [...targets];
  let logged = false;
  for (;;) {
    const probes = await Promise.all(waiting.map(probe));
    const now = Date.now();
    for (const result of probes) {
      if (!result.refused) refusedSince.delete(result.target.name);
      else if (!refusedSince.has(result.target.name)) refusedSince.set(result.target.name, now);
    }
    const notReady = probes.filter((result) => !result.ready);
    waiting = notReady.map((result) => result.target);
    if (waiting.length === 0) {
      if (logged) log(`All services ready after ${seconds(now - started)}`);
      return;
    }
    const dead = notReady.filter(
      (result) => now - (refusedSince.get(result.target.name) ?? now) >= refusedTimeoutMs,
    );
    if (dead.length > 0 || now - started >= timeoutMs) {
      const lines = notReady.map(
        (result) => `  ${result.target.name} (${result.target.url}): ${result.reason}`,
      );
      throw new Error(
        dead.length > 0
          ? `Not running: ${dead.map((result) => result.target.name).join(', ')}. Start it again before the next beat.\n${lines.join('\n')}`
          : `Services not ready after ${seconds(timeoutMs)}:\n${lines.join('\n')}`,
      );
    }
    if (!logged) {
      log(`Waiting for services to be ready: ${waiting.map((target) => target.name).join(', ')}`);
      logged = true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function probe(target: ReadyTarget): Promise<Probe> {
  const url = new URL('/health/ready', target.url);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (response.ok) return { target, ready: true, refused: false, reason: 'ready' };
    const reason = `not ready (${downChecks(await response.text())})`;
    return { target, ready: false, refused: false, reason };
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    if (code === 'ECONNREFUSED') {
      return { target, ready: false, refused: true, reason: 'not running (connection refused)' };
    }
    const reason = `unreachable (${code ?? (error as Error).name})`;
    return { target, ready: false, refused: false, reason };
  }
}

function seconds(ms: number): string {
  return `${String(Math.round(ms / 1000))}s`;
}

/** The checks a readiness body reports down, e.g. `postgres: timed out`. */
function downChecks(body: string): string {
  try {
    const { checks } = JSON.parse(body) as {
      checks?: Record<string, { status: string; error?: string }>;
    };
    const down = Object.entries(checks ?? {})
      .filter(([, check]) => check.status !== 'up')
      .map(([name, check]) => (check.error ? `${name}: ${check.error}` : name));
    if (down.length > 0) return down.join('; ');
  } catch {
    // Not a readiness body; show its start below.
  }
  return body.slice(0, 200) || 'no body';
}
