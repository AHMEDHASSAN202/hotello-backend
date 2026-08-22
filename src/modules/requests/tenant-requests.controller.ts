import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentTenantUser } from '../../common/decorators/current-tenant-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { TenantScope } from '../../common/decorators/tenant-scope.decorator';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { AssignRequestDto } from './dto/assign-request.dto';
import { CancelRequestDto } from './dto/cancel-request.dto';
import { ListTenantRequestsQueryDto } from './dto/list-tenant-requests-query.dto';
import { TenantRequestsService } from './tenant-requests.service';

/**
 * Epic 15, Stories 15.4–15.6 — the tenant requests board + lifecycle.
 * First real @RequireModule consumer: TenantAccessGuard 403s
 * MODULE_NOT_ENABLED before permissions run when `requests` is not in the
 * plan (permissions stay dormant — Epic 10 rule). Static routes are
 * declared above `:id` (Nest matches in declaration order).
 */
@TenantScope()
@RequireModule('requests')
@Controller('tenant/requests')
export class TenantRequestsController {
  constructor(private readonly requests: TenantRequestsService) {}

  @Get()
  @RequirePermissions('requests.read')
  list(
    @CurrentTenantUser() user: TenantUser,
    @Query() query: ListTenantRequestsQueryDto,
  ) {
    return query.tab === 'history'
      ? this.requests.listHistory(user, query)
      : this.requests.listBoard(user, query);
  }

  @Get('assignees')
  @RequirePermissions('requests.read')
  assignees(@CurrentTenantUser() user: TenantUser) {
    return this.requests.listAssignees(user);
  }

  @Get(':id')
  @RequirePermissions('requests.read')
  detail(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.requests.getDetail(user, id);
  }

  @Post(':id/start')
  @HttpCode(200)
  @RequirePermissions('requests.update')
  start(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.requests.start(user, id);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermissions('requests.update')
  complete(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.requests.complete(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('requests.update')
  cancel(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelRequestDto,
  ) {
    return this.requests.cancel(user, id, dto);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @RequirePermissions('requests.assign')
  assign(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignRequestDto,
  ) {
    return this.requests.assign(user, id, dto);
  }
}
