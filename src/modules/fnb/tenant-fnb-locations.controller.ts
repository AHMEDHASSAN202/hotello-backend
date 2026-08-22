import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { CurrentTenantUser } from '../../common/decorators/current-tenant-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScope } from '../../common/decorators/tenant-scope.decorator';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import {
  CreateFnbLocationDto,
  LocationQrQueryDto,
  StickerPdfQueryDto,
  UpdateFnbLocationDto,
} from './dto/fnb-location.dto';
import { FnbStickerPdfService } from './fnb-sticker-pdf.service';
import { TenantFnbLocationsService } from './tenant-fnb-locations.service';

/**
 * Epic 16, Story 16.3 — delivery locations + QR stickers. PDFs/QRs are GETs
 * (Epic 11 ruling: printing is setup, not a mutation — stays available under
 * read-only subscriptions).
 */
@TenantScope()
@RequireModule('fnb')
@Controller('tenant/fnb-locations')
export class TenantFnbLocationsController {
  constructor(
    private readonly locations: TenantFnbLocationsService,
    private readonly stickers: FnbStickerPdfService,
  ) {}

  /** Board destination filter needs names — read gate is fnb_orders.read. */
  @Get()
  @RequirePermissions('fnb_orders.read')
  list(@CurrentTenantUser() user: TenantUser) {
    return this.locations.list(user.hotelId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('fnb_locations.manage')
  create(
    @CurrentTenantUser() user: TenantUser,
    @Body() dto: CreateFnbLocationDto,
  ) {
    return this.locations.create(user, dto);
  }

  @Patch(':id')
  @RequirePermissions('fnb_locations.manage')
  update(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFnbLocationDto,
  ) {
    return this.locations.update(user, id, dto);
  }

  /** Viewable/copyable QR (16.3 AC2) — inline PNG/SVG, optional spot. */
  @Get(':id/qr')
  @RequirePermissions('fnb_locations.manage')
  async locationQr(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: LocationQrQueryDto,
    @Res() res: Response,
  ) {
    const format = query.format ?? 'png';
    const { body, contentType, key } = await this.stickers.locationQr(
      user.hotelId,
      id,
      format,
      query.spot,
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="location-${key}.${format === 'svg' ? 'svg' : 'png'}"`,
    );
    res.send(body);
  }

  /** Single zone sticker (no range) or a numbered series (16.3 AC2). */
  @Get(':id/pdf/stickers')
  @RequirePermissions('fnb_locations.manage')
  async stickerPdf(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: StickerPdfQueryDto,
    @Res() res: Response,
  ) {
    const buffer = await this.stickers.generateStickers(
      user.hotelId,
      id,
      query,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="location-stickers.pdf"',
    );
    res.send(buffer);
  }
}
