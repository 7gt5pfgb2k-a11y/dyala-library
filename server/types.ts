// Minimal Cloudflare binding types, so the project builds without @cloudflare/workers-types.
export interface D1Result<T = any> {
  results: T[];
  success: boolean;
}
export interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = any>(): Promise<T | null>;
  all<T = any>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}
export interface R2ObjectBody {
  body: ReadableStream;
  size: number;
  httpEtag: string;
}
export interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(key: string, value: ArrayBuffer | string, options?: any): Promise<unknown>;
  delete(key: string | string[]): Promise<void>;
}
export interface Env {
  DB: D1Database;
  BOOKS: R2Bucket;
  SESSION_SECRET: string;
  ADMIN_PASSWORD: string;
  DYALA_PASSWORD: string;
}
