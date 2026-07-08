import { z } from 'zod';

// 集中配置的 zod 校验模式,校验失败即启动失败(硬规范)
export const configSchema = z.object({
  app: z.object({
    port: z.number().int().positive().default(3000),
    globalPrefix: z.string().default(''),
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
  }),
  manticore: z.object({
    url: z.string().min(1),
  }),
});

export type AppConfig = z.infer<typeof configSchema>;
