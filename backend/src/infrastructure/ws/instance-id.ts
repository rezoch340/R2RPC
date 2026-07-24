import { randomUUID } from 'node:crypto';

// 本进程实例身份(每次启动一个,用于分布式路由 —— session 亲和 + pub/sub 目的地)
export const INSTANCE_IDENTIFIER = randomUUID();
