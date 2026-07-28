import { DocumentBuilder } from '@nestjs/swagger';

export const ADMINISTRATOR_JWT_SECURITY_NAME = 'adminJwt';
export const ACCESS_TOKEN_SECURITY_NAME = 'accessToken';

export function buildOpenApiConfiguration() {
  return new DocumentBuilder()
    .setTitle('R2RPC API')
    .setDescription(
      'R2RPC 管理控制面、调用方 RPC 与监控查询的 HTTP API。设备长连接协议使用 WebSocket，另见项目协议文档。',
    )
    .setVersion('0.1.1')
    .setContact('R2RPC Contributors', 'https://github.com/rezoch340/R2RPC', '')
    .setLicense(
      'UNLICENSED',
      'https://github.com/rezoch340/R2RPC/blob/main/LICENSE',
    )
    .addServer('/', '当前部署')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: '后台登录接口签发的管理员 JWT。',
      },
      ADMINISTRATOR_JWT_SECURITY_NAME,
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'R2RPC Access Token',
        description: '访问令牌管理页面生成的 rk_ 前缀 Access Token。',
      },
      ACCESS_TOKEN_SECURITY_NAME,
    )
    .addTag('auth', '后台账号登录和当前身份')
    .addTag('users', '后台账号管理')
    .addTag('rbac', '权限组、权限和用户授权')
    .addTag('projects', '功能组管理与运行统计')
    .addTag('device-token', '设备上线凭证')
    .addTag('access-token', 'RPC 调用方凭证')
    .addTag('devices', '设备持久态')
    .addTag('rpc', '公开 RPC 调用和后台手动调试')
    .addTag('monitor', '请求日志与 AppAudit 详情')
    .addTag('metrics', '请求和设备聚合指标')
    .addTag('system-logs', '后台系统操作审计')
    .build();
}
