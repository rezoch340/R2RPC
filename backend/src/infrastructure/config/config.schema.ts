import { z } from 'zod';

// 集中配置的 zod 校验模式,校验失败即启动失败(硬规范)
export const configSchema = z.object({
  app: z.object({
    port: z.number().int().positive().default(3000),
    globalPrefix: z.string().default(''),
    // 手机端下发的 WebSocket 公网地址前缀;不填则用 ws://127.0.0.1:{port}
    publicWsUrl: z.string().optional(),
    corsOrigins: z.array(z.string().min(1)).min(1).default(['*']),
    openApiEnabled: z.boolean().default(true),
    trustedProxyHops: z.number().int().min(0).max(16).default(0),
  }),
  frontend: z
    .object({
      apiUrl: z.string().url().nullable().default(null),
      apiPort: z.number().int().positive().default(3000),
      allowedDevOrigins: z.array(z.string().min(1)).default([]),
    })
    .prefault({}),
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
  bootstrap: z
    .object({
      admin: z
        .object({
          username: z.string().min(1).max(64).default('admin'),
          password: z.string().min(8).max(128).default('admin123456'),
        })
        .prefault({}),
    })
    .prefault({}),
  performance: z
    .object({
      baseUrl: z.string().url().default('http://127.0.0.1:3000'),
      projectName: z.string().min(1).max(128).default('cn-nodes'),
      virtualDeviceCount: z.number().int().min(2).max(32).default(4),
      durationSeconds: z.number().int().min(5).max(600).default(20),
      warmupSeconds: z.number().int().min(0).max(60).default(3),
      concurrency: z.number().int().min(1).max(512).default(16),
      targetRequestsPerSecond: z.number().int().min(1).max(5000).default(80),
      requestTimeoutMilliseconds: z
        .number()
        .int()
        .min(100)
        .max(60000)
        .default(5000),
      maximumErrorRate: z.number().min(0).max(1).default(0.01),
      maximum95thPercentileLatencyMilliseconds: z
        .number()
        .int()
        .positive()
        .default(750),
      minimumThroughputRequestsPerSecond: z.number().positive().default(60),
      resultFile: z.string().min(1).default('performance-results/latest.json'),
    })
    .prefault({}),
  // 日志保留(request_logs);非法值(≤0)直接校验失败终止,不静默兜底
  retention: z
    .object({
      rawRetentionDays: z.number().int().positive().default(3),
      keepLatestPerScope: z.number().int().positive().default(100),
      aggregateRetentionDays: z.number().int().positive().default(30),
      // 设备连续多少天没再上线即自动软删;重新连回来会复用原行回滚软删
      deviceIdleDeleteDays: z.number().int().positive().default(3),
    })
    .prefault({}),
});

export type AppConfig = z.infer<typeof configSchema>;
