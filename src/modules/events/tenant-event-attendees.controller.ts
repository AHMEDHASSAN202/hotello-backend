import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { CurrentTenantUser } from '../../common/decorators/current-tenant-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScope } from '../../common/decorators/tenant-scope.decorator';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { TenantEventAttendeesService } from './tenant-event-attendees.service';

/**
 * Story 21.6 AC1 — the read-only attendee list + live totals for one event.
 * Its own controller/service (Task 8), separate from `TenantEventsController`
 * (CRUD/publish/cancel, Task 4/6) per the module doc's task split; settlement
 * (Task 9) is a later addition, not this one.
 */
@TenantScope()
@RequireModule('events')
@Controller('tenant/events')
export class TenantEventAttendeesController {
  constructor(private readonly attendees: TenantEventAttendeesService) {}

  @Get(':eventId/attendees')
  @RequirePermissions('events.read')
  list(
    @CurrentTenantUser() user: TenantUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.attendees.list(user, eventId);
  }
}
