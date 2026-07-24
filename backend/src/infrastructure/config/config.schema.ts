import { z } from 'zod';

// 集中配置的 zod 校验模式,校验失败即启动失败(硬规范)
export const configSchema = z.object({
  app: z.object({
    port: z.number().int().positive().default(3000),
    globalPrefix: z.string().default(''),
    // 手机端下发的 WebSocket 公网地址前缀;不填则用 ws://127.0.0.1:{port}
    publicWsUrl: z.string().optional(),
  }),
  db: z.object({
    host: z.string(),
    port: z.number().int().positive(),
    user: z.string(),
    password: z.string(),
    database: z.string(),
  }),
  redis: z.object({
    host: z.string(),
    port: z.number().int().positive(),
    password: z.string().nullable().default(null),
    db: z.number().int().min(0).default(0),
  }),
  jwt: z.object({
    secret: z.string().min(1),
    expiresIn: z.string().default('7d'),
    authorizationCacheTtlSeconds: z.number().int().min(60).max(300).default(60),
  }),
  manticore: z.object({
    url: z.string().min(1),
  }),
  // 日志保留(request_logs);非法值(≤0)直接校验失败终止,不静默兜底
  retention: z
    .object({
      rawRetentionDays: z.number().int().positive().default(3),
      keepLatestPerScope: z.number().int().positive().default(100),
      aggregateRetentionDays: z.number().int().positive().default(30),
    })
    .prefault({}),
});

export type AppConfig = z.infer<typeof configSchema>;
