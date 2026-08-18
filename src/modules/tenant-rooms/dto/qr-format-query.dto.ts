import { IsIn, IsOptional } from 'class-validator';
import { QrFormat } from '../room-qr.service';

/** Story 11.5 AC3 — `?format=png|svg` on the QR endpoints; anything else 400s. */
export class QrFormatQueryDto {
  @IsOptional()
  @IsIn(['png', 'svg'])
  format?: QrFormat = 'png';
}
