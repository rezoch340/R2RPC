import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { QuerySystemLogsDto } from './dto/query-system-logs.dto';
import { SystemLogsService } from './system-logs.service';

@ApiTags('system-logs')
@ApiBearerAuth()
@Controller('system-logs')
export class SystemLogsController {
  constructor(private readonly systemLogsService: SystemLogsService) {}

  @Get()
  @RequirePermission('read', 'system-log')
  @ApiOperation({ summary: '系统操作审计日志列表' })
  list(@Query() query: QuerySystemLogsDto) {
    return this.systemLogsService.list(query);
  }
}
