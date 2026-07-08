# Changelog

本项目重要改动记录于此。格式参考 [Keep a Changelog](https://keepachangelog.com/),语义化版本。

## [Unreleased]

### 进行中 · 阶段1 设备组一等实体(3/6)
- 设备组升为一等实体(FK);新增 `client_groups` 关联表,一个设备可属于多个组;`clients`/`devices` 去掉松散的 `group_name` 字符串。
- 设备登录改为按 `client_groups` 授权:组成员关系以库表为准,不再采信客户端自报的组;设备账号「建号 + 建组关联」走单事务并对组名去重。
- 迁移回填脚本(旧 `group_name` → `groups` + `client_groups`)作为生产参考。
- 待续:WS presence 按 group_id 多组登记、invoke 按 group_id 调度、种子 + 端到端 smoke。

### 设计
- 三套授权域设计定稿:**后台 CASL RBAC** + **设备组一等实体(设备多组)** + **invoke 独立 access token**(按设备组作用域、可过期)。
  见 `docs/superpowers/specs/2026-07-08-group-scoped-rbac-invoke-tokens-design.md`,分 3 阶段落地。
