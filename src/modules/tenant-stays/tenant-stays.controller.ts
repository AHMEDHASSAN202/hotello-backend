import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentTenantUser } from '../../common/decorators/current-tenant-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScope } from '../../common/decorators/tenant-scope.decorator';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { CreateStayDto } from './dto/create-stay.dto';
import { ListStaysQueryDto } from './dto/list-stays-query.dto';
import { TenantStaysService } from './tenant-stays.service';

/**
 * Stays (Epic 13). `hotel_id` always comes from the authenticated tenant
 * user, never the client. Static routes declared before `:id`.
 */
@TenantScope()
@Controller('tenant/stays')
export class TenantStaysController {
  constructor(private readonly staysService: TenantStaysService) {}

  @Get()
  @RequirePermissions('stays.read')
  list(
    @CurrentTenantUser() user: TenantUser,
    @Query() query: ListStaysQueryDto,
  ) {
    return this.staysService.list(user, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('stays.checkin')
  checkIn(@CurrentTenantUser() user: TenantUser, @Body() dto: CreateStayDto) {
    return this.staysService.checkIn(user, dto);
  }

  @Get('available-rooms')
  @RequirePermissions('stays.read')
  availableRooms(@CurrentTenantUser() user: TenantUser) {
    return this.staysService.availableRooms(user);
  }

  @Get(':id')
  @RequirePermissions('stays.read')
  detail(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.staysService.detail(user, id);
  }
}
