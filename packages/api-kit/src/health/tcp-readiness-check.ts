import { connect } from 'node:net';

import { ReadinessCheck } from './readiness-check.js';

export interface TcpProbe {
  /** Bytes to send once connected. */
  send: string;
  /** The reply must start with this. */
  expect: string;
}

/** Ready when a TCP endpoint accepts a connection and, optionally, answers a probe. */
export class TcpReadinessCheck extends ReadinessCheck {
  constructor(
    readonly name: string,
    private readonly host: string,
    private readonly port: number,
    private readonly probe?: TcpProbe,
  ) {
    super();
  }

  check(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.host, port: this.port, timeout: 2_000 });
      const fail = (error: Error) => {
        socket.destroy();
        reject(error);
      };
      socket.once('error', fail);
      socket.once('timeout', () => {
        fail(new Error('timed out'));
      });
      socket.once('connect', () => {
        if (!this.probe) {
          socket.end();
          resolve();
          return;
        }
        const { send, expect } = this.probe;
        socket.once('data', (data) => {
          socket.end();
          if (data.toString().startsWith(expect)) {
            resolve();
          } else {
            reject(new Error(`unexpected reply: ${data.toString().trim()}`));
          }
        });
        socket.write(send);
      });
    });
  }
}
