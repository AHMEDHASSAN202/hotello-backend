import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsUUID } from 'class-validator';

export type CardsScope = 'all' | 'floors' | 'rooms';

/** roomIds beyond this many in one request 400s (ArrayMaxSize) — keeps a single PDF sane. */
export const MAX_CARDS_ROOM_IDS = 100;

/** `?floors=1,2,3` / `?roomIds=<uuid>,<uuid>` — comma-separated query values. */
function splitCsv(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  if (typeof value !== 'string' || value.trim() === '') return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * Story 11.5 AC2 — `GET /tenant/rooms/pdf/cards` query. GET (controller
 * ruling): PDF generation must stay available to read-only (expired-trial)
 * hotels, and a POST body would be blocked by `SUBSCRIPTION_READ_ONLY`.
 */
export class CardsPdfQueryDto {
  @IsIn(['all', 'floors', 'rooms'])
  scope: CardsScope;

  @IsOptional()
  @Transform(({ value }) => splitCsv(value).map((v) => Number(v)))
  @IsArray()
  @IsInt({ each: true })
  floors?: number[];

  @IsOptional()
  @Transform(({ value }) => splitCsv(value))
  @IsArray()
  @ArrayMaxSize(MAX_CARDS_ROOM_IDS)
  @IsUUID('4', { each: true })
  roomIds?: string[];
}
