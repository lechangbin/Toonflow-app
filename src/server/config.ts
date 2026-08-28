export interface ServerConfig {
  host: string;
  port: number;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 10588;

export function resolveServerConfig(environment: Record<string, string | undefined> = process.env): ServerConfig {
  const host = environment.HOST?.trim() || DEFAULT_HOST;
  const rawPort = environment.PORT?.trim();
  const port = rawPort === undefined || rawPort === "" ? DEFAULT_PORT : Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535; received ${JSON.stringify(rawPort)}`);
  }

  return { host, port };
}
