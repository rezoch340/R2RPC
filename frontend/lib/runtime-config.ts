import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';

export interface FrontendRuntimeConfiguration {
  apiUrl?: string;
  apiPort?: number;
}

let cachedConfiguration: FrontendRuntimeConfiguration | null = null;

function resolveConfigurationPath(): string | null {
  if (process.env.FRONTEND_CONFIG_FILE) {
    return process.env.FRONTEND_CONFIG_FILE;
  }
  return existsSync('/app/frontend.yaml') ? '/app/frontend.yaml' : null;
}

export function readRuntimeConfiguration(): FrontendRuntimeConfiguration {
  if (cachedConfiguration) {
    return cachedConfiguration;
  }

  cachedConfiguration = {};
  const configurationPath = resolveConfigurationPath();
  if (!configurationPath || !existsSync(configurationPath)) {
    return cachedConfiguration;
  }

  try {
    const parsedConfiguration: unknown = parse(
      readFileSync(configurationPath, 'utf8'),
    );
    if (!parsedConfiguration || typeof parsedConfiguration !== 'object') {
      return cachedConfiguration;
    }
    const configurationValues = parsedConfiguration as Record<string, unknown>;
    if (typeof configurationValues.apiUrl === 'string') {
      cachedConfiguration.apiUrl = configurationValues.apiUrl;
    }
    if (typeof configurationValues.apiPort === 'number') {
      cachedConfiguration.apiPort = configurationValues.apiPort;
    }
  } catch (error) {
    console.error(
      `[runtime-config] 读取 ${configurationPath} 失败，使用默认配置`,
      error,
    );
  }
  return cachedConfiguration;
}
