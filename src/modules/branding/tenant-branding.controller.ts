import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentTenantUser } from '../../common/decorators/current-tenant-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScope } from '../../common/decorators/tenant-scope.decorator';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { BRANDING_COVER_MAX_BYTES } from './branding.constants';
import { UpdateBrandingDto } from './dto/update-branding.dto';
import { TenantBrandingService } from './tenant-branding.service';

@TenantScope()
@RequireModule('guest_app_branding')
@Controller('tenant/branding')
export class TenantBrandingController {
  constructor(private readonly branding: TenantBrandingService) {}

  @Get()
  @RequirePermissions('branding.manage')
  get(@CurrentTenantUser() user: TenantUser) {
    return this.branding.getBranding(user);
  }

  @Patch()
  @RequirePermissions('branding.manage')
  update(@CurrentTenantUser() user: TenantUser, @Body() dto: UpdateBrandingDto) {
    return this.branding.updateBranding(user, dto);
  }

  @Post('cover')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('branding.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: BRANDING_COVER_MAX_BYTES } }))
  setCover(@CurrentTenantUser() user: TenantUser, @UploadedFile() file?: Express.Multer.File) {
    return this.branding.setCover(user, file);
  }

  @Delete('cover')
  @RequirePermissions('branding.manage')
  removeCover(@CurrentTenantUser() user: TenantUser) {
    return this.branding.removeCover(user);
  }
}
