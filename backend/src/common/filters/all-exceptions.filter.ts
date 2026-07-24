import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SystemLogsService } from '../../application/system-logs/system-logs.service';
import type { AuthedRequest } from '../types/authed-request';
import { inferSystemAuditDefinition } from '../interceptors/system-audit-definition';
import { buildSystemAuditEntry } from '../interceptors/system-audit-entry';

// express Response 的最小切面(只用到 status().json())
interface HttpResponseLike {
  status(code: number): HttpResponseLike;
  json(body: unknown): unknown;
}

// 全局异常兜底:统一 JSON 错误结构
@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  constructor(private readonly systemLogsService: SystemLogsService) {}

  async catch(exception: unknown, host: ArgumentsHost) {
    const request = host.switchToHttp().getRequest<AuthedRequest>();
    const response = host.switchToHttp().getResponse<HttpResponseLike>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';
    await this.recordGuardOrRoutingFailure(request, status, exception);
    this.logger.error(exception);
    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
    });
  }

  private async recordGuardOrRoutingFailure(
    request: AuthedRequest,
    statusCode: number,
    exception: unknown,
  ): Promise<void> {
    if (request.systemAuditRecorded) {
      return;
    }
    const definition = inferSystemAuditDefinition(request);
    if (!definition) {
      return;
    }
    request.systemAuditRecorded = true;
    try {
      await this.systemLogsService.create(
        buildSystemAuditEntry({
          definition,
          request,
          status: 'failed',
          statusCode,
          errorMessage:
            exception instanceof Error ? exception.message : '未知错误',
        }),
      );
    } catch (auditError) {
      const errorMessage =
        auditError instanceof Error ? auditError.message : String(auditError);
      this.logger.error(`系统审计日志写入失败: ${errorMessage}`);
    }
  }
}
