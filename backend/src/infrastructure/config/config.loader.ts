import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { load } from 'js-yaml';
import { AppConfig, configSchema } from './config.schema';

export interface LoadedApplicationConfiguration {
  configurationFile: string;
  configuration: AppConfig;
}

export function resolveConfigurationFile(
  startingDirectory = process.cwd(),
): string {
  const configuredFile = process.env.CONFIG_FILE;
  if (configuredFile) {
    return resolve(configuredFile);
  }

  let currentDirectory = resolve(startingDirectory);
  while (true) {
    const candidateFile = resolve(currentDirectory, 'config.yaml');
    if (existsSync(candidateFile)) {
      return candidateFile;
    }
    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return resolve(startingDirectory, 'config.yaml');
    }
    currentDirectory = parentDirectory;
  }
}

export function loadApplicationConfiguration(
  startingDirectory = process.cwd(),
): LoadedApplicationConfiguration {
  const configurationFile = resolveConfigurationFile(startingDirectory);
  let configurationSource: unknown;
  try {
    configurationSource = load(readFileSync(configurationFile, 'utf8'));
  } catch (error) {
    throw new Error(
      `读取配置文件失败: ${configurationFile} — ${(error as Error).message}`,
    );
  }

  const validation = configSchema.safeParse(configurationSource);
  if (!validation.success) {
    throw new Error(
      `配置校验失败: ${configurationFile}\n${JSON.stringify(validation.error.format(), null, 2)}`,
    );
  }
  return {
    configurationFile,
    configuration: validation.data,
  };
}
