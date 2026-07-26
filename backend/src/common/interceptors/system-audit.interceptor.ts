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
  of,
  throwError,
} from 'rxjs';
import { SystemLogsService } from '../../application/system-logs/system-logs.service';
import {
  SYSTEM_AUDIT_KEY,
  SystemAuditDefinition,
} from '../decorators/system-audit.decorator';
import type { AuthedRequest } from '../types/authed-request';
import { inferSystemAuditDefinition } from './system-audit-definition';
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
    const request = executionContext.switchToHttp().getRequest<AuthedRequest>();
    const explicitDefinition = this.reflector.get<SystemAuditDefinition>(
      SYSTEM_AUDIT_KEY,
      executionContext.getHandler(),
    );
    const definition =
      explicitDefinition ?? inferSystemAuditDefinition(request);
    if (!definition) {
      return next.handle();
    }
    const response = executionContext
      .switchToHttp()
      .getResponse<{ statusCode: number }>();
    return next.handle().pipe(
      concatMap((responseBody: unknown) => {
        // 读取自身的成功调用不入库,否则日志表被自己的读取污染、翻页必然重复;
        // 失败分支不受影响,鉴权拒绝仍然留痕
        if (this.skipsSuccessfulRead(definition)) {
          return of(responseBody);
        }
        return from(
          this.recordAndMark(
            request,
            buildSystemAuditEntry({
              definition,
              request,
              responseBody,
              status: 'succeeded',
              statusCode: response.statusCode,
            }),
          ),
        ).pipe(map(() => responseBody));
      }),
      catchError((handlerError: unknown) =>
        from(
          this.recordAndMark(
            request,
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

  private skipsSuccessfulRead(definition: SystemAuditDefinition): boolean {
    return (
      definition.skipSuccessfulRead === true && definition.action === 'read'
    );
  }

  private async recordAndMark(
    request: AuthedRequest,
    input: Parameters<SystemLogsService['create']>[0],
  ): Promise<void> {
    request.systemAuditRecorded = true;
    await this.recordSafely(input);
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
