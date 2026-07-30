import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantRole } from './tenant-role.entity';
import { TenantRolesController } from './tenant-roles.controller';
import { TenantRolesService } from './tenant-roles.service';

@Module({
  imports: [TypeOrmModule.forFeature([TenantRole])],
  controllers: [TenantRolesController],
  providers: [TenantRolesService],
  exports: [TenantRolesService, TypeOrmModule],
})
export class TenantRolesModule {}
