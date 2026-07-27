import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Admin } from '../admins/admin.entity';
import { CreatePlanDto } from './dto/create-plan.dto';
import { ListPlansQueryDto } from './dto/list-plans-query.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { PlansService } from './plans.service';

/** No DELETE route by design — plans are soft-archived only (SA-PLAN-5). */
@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get()
  @RequirePermissions('plans.read')
  findAll(@Query() query: ListPlansQueryDto) {
    return this.plansService.findAll(query);
  }

  @Get('modules/catalog')
  @RequirePermissions('plans.read')
  getModuleCatalog() {
    return this.plansService.getModuleCatalog();
  }

  @Get(':id')
  @RequirePermissions('plans.read')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.plansService.findOne(id);
  }

  @Get(':id/subscribers')
  @RequirePermissions('plans.read', 'subscriptions.read')
  findSubscribers(@Param('id', ParseUUIDPipe) id: string) {
    return this.plansService.findSubscribers(id);
  }

  @Post()
  @RequirePermissions('plans.create')
  create(@Body() dto: CreatePlanDto, @CurrentAdmin() actor: Admin) {
    return this.plansService.create(dto, actor);
  }

  @Patch(':id')
  @RequirePermissions('plans.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
    @CurrentAdmin() actor: Admin,
  ) {
    return this.plansService.update(id, dto, actor);
  }

  @Patch(':id/archive')
  @RequirePermissions('plans.archive')
  archive(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() actor: Admin) {
    return this.plansService.archive(id, actor);
  }

  @Patch(':id/restore')
  @RequirePermissions('plans.update')
  restore(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() actor: Admin) {
    return this.plansService.restore(id, actor);
  }
}
