import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Hotel } from '../hotels/hotel.entity';
import { RenditionsModule } from '../renditions/renditions.module';
import { TenantBrandingController } from './tenant-branding.controller';
import { TenantBrandingService } from './tenant-branding.service';

@Module({
  imports: [TypeOrmModule.forFeature([Hotel]), AuditLogsModule, RenditionsModule],
  controllers: [TenantBrandingController],
  providers: [TenantBrandingService],
})
export class BrandingModule {}
