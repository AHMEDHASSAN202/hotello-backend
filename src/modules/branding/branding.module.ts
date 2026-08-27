import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { Hotel } from '../hotels/hotel.entity';
import { TenantBrandingController } from './tenant-branding.controller';
import { TenantBrandingService } from './tenant-branding.service';

@Module({
  imports: [TypeOrmModule.forFeature([Hotel]), AuditLogsModule],
  controllers: [TenantBrandingController],
  providers: [TenantBrandingService],
})
export class BrandingModule {}
