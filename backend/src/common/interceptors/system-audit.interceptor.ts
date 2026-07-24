import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  catchError,
  concatMap,
  from,
  map,
  mergeMap,
  Observable,
  throwError,
} from 'rxjs';
import { SystemLogsService } from '../../application/system-logs/system-logs.service';
import {
  SYSTEM_AUDIT_KEY,
  SystemAuditDefinition,
} from '../decorators/system-audit.decorator';
import type { AuthedRequest } from '../types/authed-request';
import { buildSystemAuditEntry } from './system-audit-entry';

@Injectable()
export class SystemAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SystemAuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly systemLogsService: SystemLogsService,
  ) {}

  intercept(
    executionContext: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const definition = this.reflector.get<SystemAuditDefinition>(
      SYSTEM_AUDIT_KEY,
      executionContext.getHandler(),
    );
    if (!definition) {
      return next.handle();
    }
    const request = executionContext.switchToHttp().getRequest<AuthedRequest>();
    const response = executionContext
      .switchToHttp()
      .getResponse<{ statusCode: number }>();
    return next.handle().pipe(
      concatMap((responseBody: unknown) =>
        from(
          this.recordSafely(
            buildSystemAuditEntry({
              definition,
              request,
              responseBody,
              status: 'succeeded',
              statusCode: response.statusCode,
            }),
          ),
        ).pipe(map(() => responseBody)),
      ),
      catchError((handlerError: unknown) =>
        from(
          this.recordSafely(
            buildSystemAuditEntry({
              definition,
              request,
              status: 'failed',
              statusCode: this.statusCodeOf(handlerError),
              errorMessage: this.errorMessageOf(handlerError),
            }),
          ),
        ).pipe(mergeMap(() => throwError(() => handlerError))),
      ),
    );
  }

  private async recordSafely(
    input: Parameters<SystemLogsService['create']>[0],
  ): Promise<void> {
    try {
      await this.systemLogsService.create(input);
    } catch (auditError) {
      const message =
        auditError instanceof Error ? auditError.message : String(auditError);
      this.logger.error(`系统审计日志写入失败: ${message}`);
    }
  }

  private statusCodeOf(error: unknown): number {
    return error instanceof HttpException ? error.getStatus() : 500;
  }

  private errorMessageOf(error: unknown): string {
    return error instanceof Error ? error.message : '未知错误';
  }
}
