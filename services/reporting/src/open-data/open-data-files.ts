/**
 * The open-data bucket, behind a port: the release build writes a release's dataset files and
 * the public API (#355) and the Commission preview read them back by key. The service uses the
 * S3 adapter (`S3OpenDataFiles`); tests use an in-memory one.
 */
export abstract class OpenDataFiles {
  /** Writes (or overwrites) the object at `key`; `OpenDataStorageUnavailable` when it cannot. */
  abstract put(file: { key: string; body: Uint8Array; contentType: string }): Promise<void>;

  /**
   * The object's bytes; `OpenDataFileMissing` when there is none, `OpenDataStorageUnavailable`
   * when storage cannot be reached.
   */
  abstract get(key: string): Promise<Uint8Array>;
}

/** Object storage could not be reached or refused the request. */
export class OpenDataStorageUnavailable extends Error {
  override readonly name = 'OpenDataStorageUnavailable';
}

/** No object at the key. */
export class OpenDataFileMissing extends Error {
  override readonly name = 'OpenDataFileMissing';
}
