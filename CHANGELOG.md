# Changelog

本项目重要改动记录于此。格式参考 [Keep a Changelog](https://keepachangelog.com/),语义化版本。

## [Unreleased]

### 设计
- 三套授权域设计定稿:**后台 CASL RBAC** + **设备组一等实体(设备多组)** + **invoke 独立 access token**(按设备组作用域、可过期)。
  见 `docs/superpowers/specs/2026-07-08-group-scoped-rbac-invoke-tokens-design.md`,分 3 阶段落地。
