/** A read-only view of a cloud storage container or bucket holding log files. */
export interface LogObject { name: string; etag: string; updated?: Date }

export interface LogBucket {
  /** Where this is, for batch names and messages, e.g. azure://account/container or gs://bucket. */
  readonly url: string;
  list(prefix?: string): AsyncIterable<LogObject>;
  read(name: string): Promise<Buffer>;
}
