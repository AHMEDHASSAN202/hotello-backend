import { IsIn, IsOptional } from 'class-validator';

export type PosterSize = 'a4' | 'a5';

/** `?size=a4|a5` on `GET /tenant/rooms/pdf/poster`; anything else 400s. */
export class PosterPdfQueryDto {
  @IsOptional()
  @IsIn(['a4', 'a5'])
  size?: PosterSize = 'a4';
}
