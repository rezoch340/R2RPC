# Changelog

本项目重要改动记录于此。格式参考 [Keep a Changelog](https://keepachangelog.com/),语义化版本。

## [Unreleased]

### 已完成 · 阶段1 设备组一等实体(6/6)
- 设备组升为一等实体(FK);新增 `client_groups` 关联表,一个设备可属于多个组;`clients`/`devices` 去掉松散的 `group_name` 字符串。
- 设备登录改为按 `client_groups` 授权:组成员关系以库表为准,不再采信客户端自报的组;设备账号「建号 + 建组关联」走单事务并对组名去重。
- WS presence 按 group_id 多组登记,`rpc/invoke/:group/:action` 按组名解析 group_id 调度;跨实例 session/waiter/去重(dedup)走 Redis,分布式路由闭环。
- 迁移回填脚本(旧 `group_name` → `groups` + `client_groups`)作为生产参考。
- 种子脚本(`seed-admin.ts`)追加建 demo 组 `cn-nodes`/`us-nodes` + 多组设备 `dev-001`(幂等);端到端 smoke(登录 → WS 上线 → 心跳 → 多组 invoke → 超时 → 无分组)全绿,阶段1 收尾。
- 顺带修了个阶段1 遗留 bug:`ClusterBus` 的 redis 订阅连接原本建在 `onModuleInit` 里,但依赖方 `ConnectionRegistry` 在 `WsModule` 的 providers 数组里排在它前面,Nest 按声明顺序调 `onModuleInit` 导致订阅先于连接建好触发,API 进程必炸;改成在构造函数里建连接(`RedisService.client` 构造时已就绪),去掉这个初始化顺序依赖。

### 设计
- 三套授权域设计定稿:**后台 CASL RBAC** + **设备组一等实体(设备多组)** + **invoke 独立 access token**(按设备组作用域、可过期)。
  见 `docs/superpowers/specs/2026-07-08-group-scoped-rbac-invoke-tokens-design.md`,分 3 阶段落地。
