import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Admin } from './admin.entity';
import { AdminsService } from './admins.service';
import { CreateAdminDto } from './dto/create-admin.dto';
import { ListAdminsQueryDto } from './dto/list-admins-query.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

@Controller('admins')
export class AdminsController {
  constructor(private readonly adminsService: AdminsService) {}

  @Get()
  @RequirePermissions('admins.read')
  findAll(@Query() query: ListAdminsQueryDto) {
    return this.adminsService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('admins.read')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminsService.findOne(id);
  }

  @Post()
  @RequirePermissions('admins.create')
  create(@Body() dto: CreateAdminDto) {
    return this.adminsService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('admins.update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAdminDto) {
    return this.adminsService.update(id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions('admins.update')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentAdmin() current: Admin,
  ) {
    return this.adminsService.updateStatus(id, dto.isActive, current.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('admins.delete')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() current: Admin) {
    return this.adminsService.remove(id, current.id);
  }
}
