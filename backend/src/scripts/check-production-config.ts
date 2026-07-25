import { loadApplicationConfiguration } from '../infrastructure/config/config.loader';

type ValidationRule = {
  valid: boolean;
  message: string;
};

function isExampleHostname(hostname: string): boolean {
  return hostname === 'example.com' || hostname.endsWith('.example.com');
}

function isSecureOrigin(value: string): boolean {
  try {
    const parsedUrl = new URL(value);
    return (
      parsedUrl.protocol === 'https:' &&
      parsedUrl.origin === value &&
      !isExampleHostname(parsedUrl.hostname)
    );
  } catch {
    return false;
  }
}

function isSecureWebSocketUrl(value: string): boolean {
  try {
    const parsedUrl = new URL(value);
    return (
      parsedUrl.protocol === 'wss:' &&
      parsedUrl.pathname === '/api/client/ws' &&
      parsedUrl.search === '' &&
      parsedUrl.hash === '' &&
      parsedUrl.username === '' &&
      parsedUrl.password === '' &&
      !isExampleHostname(parsedUrl.hostname)
    );
  } catch {
    return false;
  }
}

function isProductionSecret(
  value: string,
  prohibitedValues: string[],
  minimumLength: number,
): boolean {
  return (
    value.length >= minimumLength &&
    !prohibitedValues.includes(value) &&
    !value.startsWith('REPLACE_WITH_')
  );
}

const configuration = loadApplicationConfiguration(process.cwd()).configuration;
const publicWebSocketUrl = configuration.app.publicWsUrl ?? '';
const frontendApiUrl = configuration.frontend.apiUrl ?? '';

const validationRules: ValidationRule[] = [
  {
    valid: configuration.app.openApiEnabled === false,
    message: 'app.openApiEnabled 必须为 false',
  },
  {
    valid: configuration.app.trustedProxyHops === 1,
    message: 'Nginx/OpenResty 单跳部署的 app.trustedProxyHops 必须为 1',
  },
  {
    valid:
      configuration.app.corsOrigins.length > 0 &&
      configuration.app.corsOrigins.every(isSecureOrigin),
    message: 'app.corsOrigins 必须是非 example.com 的精确 HTTPS Origin',
  },
  {
    valid: isSecureWebSocketUrl(publicWebSocketUrl),
    message:
      'app.publicWsUrl 必须是非 example.com 的 wss://.../api/client/ws 地址',
  },
  {
    valid: isSecureOrigin(frontendApiUrl),
    message: 'frontend.apiUrl 必须是非 example.com 的 HTTPS Origin',
  },
  {
    valid: isProductionSecret(
      configuration.jwt.secret,
      ['change-me-before-production'],
      32,
    ),
    message: 'jwt.secret 必须替换为至少 32 字符的生产随机值',
  },
  {
    valid: isProductionSecret(
      configuration.bootstrap.admin.password,
      ['admin123456'],
      16,
    ),
    message: 'bootstrap.admin.password 必须替换为至少 16 字符的生产密码',
  },
  {
    valid: isProductionSecret(configuration.db.password, ['r2rpc'], 16),
    message: 'db.password 必须替换并同步到 PostgreSQL 初始化配置',
  },
];

const validationErrors = validationRules
  .filter((validationRule) => !validationRule.valid)
  .map((validationRule) => validationRule.message);

if (validationErrors.length > 0) {
  console.error('生产配置检查失败:');
  for (const validationError of validationErrors) {
    console.error(`- ${validationError}`);
  }
  process.exitCode = 1;
} else {
  console.log('生产配置检查通过');
}
