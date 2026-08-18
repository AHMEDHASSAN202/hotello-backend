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
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantScope } from '../../common/decorators/tenant-scope.decorator';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { BulkCommitDto } from './dto/bulk-commit.dto';
import { BulkPreviewDto } from './dto/bulk-preview.dto';
import { CardsPdfQueryDto } from './dto/cards-pdf.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { ListRoomsQueryDto } from './dto/list-rooms-query.dto';
import { PosterPdfQueryDto } from './dto/poster-pdf.dto';
import { QrFormatQueryDto } from './dto/qr-format-query.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { RoomsPdfService } from './pdf/rooms-pdf.service';
import { TenantRoomsService } from './tenant-rooms.service';

/**
 * Rooms (Epic 11, Story 11.2+). `hotel_id` always comes from the
 * authenticated tenant user, never the client. Registered after
 * `RoomTypesController` in the module so `tenant/room-types` never falls
 * through this controller's `:id` wildcard.
 */
@TenantScope()
@Controller('tenant/rooms')
export class TenantRoomsController {
  constructor(
    private readonly roomsService: TenantRoomsService,
    private readonly roomsPdfService: RoomsPdfService,
  ) {}

  @Get()
  @RequirePermissions('rooms.read')
  list(
    @CurrentTenantUser() user: TenantUser,
    @Query() query: ListRoomsQueryDto,
  ) {
    return this.roomsService.list(user.hotelId, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('rooms.create')
  async create(
    @CurrentTenantUser() user: TenantUser,
    @Body() dto: CreateRoomDto,
  ) {
    const room = await this.roomsService.createRoom(user, dto);
    return this.roomsService.toRoomView(room);
  }

  // NOTE: later tasks add more static routes here (pdf/*, export, import/*)
  // — every static route MUST be declared above `:id`, since Nest matches
  // routes in declaration order and `:id` would otherwise swallow them.
  @Post('bulk/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('rooms.create')
  bulkPreview(
    @CurrentTenantUser() user: TenantUser,
    @Body() dto: BulkPreviewDto,
  ) {
    return this.roomsService.bulkPreview(user, dto);
  }

  @Post('bulk')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('rooms.create')
  bulkCommit(@CurrentTenantUser() user: TenantUser, @Body() dto: BulkCommitDto) {
    return this.roomsService.bulkCommit(user, dto);
  }

  /**
   * Story 11.5 AC3/AC4 — the hotel-wide guest-app QR. `qr/general` must stay
   * declared above `:id` (a static two-segment route can't collide with the
   * one-segment `:id` pattern, but the file follows the same static-above-
   * dynamic discipline as the bulk routes for readability).
   */
  @Get('qr/general')
  @RequirePermissions('rooms.read')
  async generalQr(
    @CurrentTenantUser() user: TenantUser,
    @Query() query: QrFormatQueryDto,
    @Res() res: Response,
  ) {
    const { body, contentType, filename } = await this.roomsService.generalQr(
      user.hotelId,
      query.format ?? 'png',
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(body);
  }

  /**
   * Story 11.5 AC1/AC2 — print-ready QR PDFs. **GET, not POST, by ruling:**
   * PDF generation is a read and must keep working for expired-trial
   * (read-only) hotels — `SUBSCRIPTION_READ_ONLY` only blocks mutations, and
   * a POST body would trip it. `pdf/*` stays declared above `:id` (same
   * static-above-dynamic discipline as `qr/general` and the `bulk/*` routes).
   * Nothing is persisted beyond the one-time `hotel.qrGeneratedAt` stamp the
   * service sets on first generation.
   */
  @Get('pdf/poster')
  @RequirePermissions('rooms.read')
  async posterPdf(
    @CurrentTenantUser() user: TenantUser,
    @Query() query: PosterPdfQueryDto,
    @Res() res: Response,
  ) {
    const size = (query.size ?? 'a4').toUpperCase() as 'A4' | 'A5';
    const buffer = await this.roomsPdfService.generatePoster(user.hotelId, size);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="qr-poster-${size.toLowerCase()}.pdf"`,
    );
    res.send(buffer);
  }

  @Get('pdf/cards')
  @RequirePermissions('rooms.read')
  async cardsPdf(
    @CurrentTenantUser() user: TenantUser,
    @Query() query: CardsPdfQueryDto,
    @Res() res: Response,
  ) {
    const buffer = await this.roomsPdfService.generateCards(user.hotelId, query);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="room-qr-cards.pdf"');
    res.send(buffer);
  }

  @Get(':id')
  @RequirePermissions('rooms.read')
  detail(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.roomsService.detail(user.hotelId, id);
  }

  /** Story 11.5 AC3/AC4 — the per-room guest-app QR; derived on demand, never stored. */
  @Get(':id/qr')
  @RequirePermissions('rooms.read')
  async roomQr(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QrFormatQueryDto,
    @Res() res: Response,
  ) {
    const { body, contentType, filename } = await this.roomsService.roomQr(
      user.hotelId,
      id,
      query.format ?? 'png',
    );
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(body);
  }

  @Patch(':id')
  @RequirePermissions('rooms.update')
  update(
    @CurrentTenantUser() user: TenantUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoomDto,
  ) {
    return this.roomsService.updateRoom(user, id, dto);
  }
}
