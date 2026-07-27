import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Admin } from '../admins/admin.entity';
import { ChangeSubscriptionDto } from './dto/change-subscription.dto';
import { ExtendTrialDto } from './dto/extend-trial.dto';
import { SubscriptionsService } from './subscriptions.service';

@Controller('hotels')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get(':id/subscription')
  @RequirePermissions('subscriptions.read')
  getForHotel(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptionsService.getForHotel(id);
  }

  @Patch(':id/subscription')
  @RequirePermissions('subscriptions.update')
  changePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeSubscriptionDto,
    @CurrentAdmin() actor: Admin,
  ) {
    return this.subscriptionsService.changePlan(id, dto, actor);
  }

  /** No permission key — the service enforces wildcard (*) only. */
  @Post(':id/subscription/extend-trial')
  extendTrial(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExtendTrialDto,
    @CurrentAdmin() actor: Admin,
  ) {
    return this.subscriptionsService.extendTrial(id, dto, actor);
  }
}
