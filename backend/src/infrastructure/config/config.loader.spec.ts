import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  loadApplicationConfiguration,
  resolveConfigurationFile,
} from './config.loader';

const originalConfiguredFile = process.env.CONFIG_FILE;
const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const temporaryDirectory = mkdtempSync(
    resolve(tmpdir(), 'r2rpc-configuration-'),
  );
  temporaryDirectories.push(temporaryDirectory);
  return temporaryDirectory;
}

function writeValidConfiguration(configurationFile: string): void {
  writeFileSync(
    configurationFile,
    `
app:
  port: 3000
  globalPrefix: ''
db:
  host: 127.0.0.1
  port: 5432
  user: r2rpc
  password: r2rpc
  database: r2rpc
redis:
  host: 127.0.0.1
  port: 6379
  password: null
  db: 0
jwt:
  secret: unit-test-secret
  expiresIn: 7d
manticore:
  url: http://127.0.0.1:9308
`,
  );
}

afterEach(() => {
  if (originalConfiguredFile === undefined) {
    delete process.env.CONFIG_FILE;
  } else {
    process.env.CONFIG_FILE = originalConfiguredFile;
  }
  while (temporaryDirectories.length > 0) {
    const temporaryDirectory = temporaryDirectories.pop();
    if (temporaryDirectory) {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
});

describe('统一配置加载器', () => {
  it('从当前目录向上查找最近的 config.yaml', () => {
    delete process.env.CONFIG_FILE;
    const projectDirectory = createTemporaryDirectory();
    const nestedDirectory = resolve(projectDirectory, 'backend', 'dist');
    mkdirSync(nestedDirectory, { recursive: true });
    const configurationFile = resolve(projectDirectory, 'config.yaml');
    writeValidConfiguration(configurationFile);

    expect(resolveConfigurationFile(nestedDirectory)).toBe(configurationFile);
  });

  it('显式 CONFIG_FILE 优先于目录查找', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const configurationFile = resolve(
      temporaryDirectory,
      'explicit-config.yaml',
    );
    writeValidConfiguration(configurationFile);
    process.env.CONFIG_FILE = configurationFile;

    expect(resolveConfigurationFile(temporaryDirectory)).toBe(
      configurationFile,
    );
  });

  it('统一 schema 为前端、CORS、管理员和保留策略填充默认值', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const configurationFile = resolve(temporaryDirectory, 'config.yaml');
    writeValidConfiguration(configurationFile);

    const loadedConfiguration =
      loadApplicationConfiguration(temporaryDirectory).configuration;

    expect(loadedConfiguration.app.corsOrigins).toEqual(['*']);
    expect(loadedConfiguration.frontend).toEqual({
      apiUrl: null,
      apiPort: 3000,
      allowedDevOrigins: [],
    });
    expect(loadedConfiguration.bootstrap.admin).toEqual({
      username: 'admin',
      password: 'admin123456',
    });
    expect(loadedConfiguration.performance).toMatchObject({
      baseUrl: 'http://127.0.0.1:3000',
      projectName: 'cn-nodes',
      virtualDeviceCount: 4,
      durationSeconds: 20,
      concurrency: 16,
      targetRequestsPerSecond: 80,
    });
    expect(loadedConfiguration.retention.aggregateRetentionDays).toBe(30);
  });

  it('配置字段非法时拒绝启动', () => {
    const temporaryDirectory = createTemporaryDirectory();
    const configurationFile = resolve(temporaryDirectory, 'config.yaml');
    writeValidConfiguration(configurationFile);
    writeFileSync(
      configurationFile,
      `${readConfiguration(configurationFile)}
frontend:
  apiUrl: not-a-url
`,
    );

    expect(() => loadApplicationConfiguration(temporaryDirectory)).toThrow(
      '配置校验失败',
    );
  });
});

function readConfiguration(configurationFile: string): string {
  return readFileSync(configurationFile, 'utf8');
}
