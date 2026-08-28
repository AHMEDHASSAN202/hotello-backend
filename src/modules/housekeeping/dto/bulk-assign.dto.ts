import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsUUID,
  ValidateIf,
} from 'class-validator';

/**
 * 20.3 AC1 — bulk-assign a floor / selection. The FE resolves a floor to its
 * room ids; the cap comfortably covers MAX_FLOOR-sized hotels in one call.
 */
export class BulkAssignDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  roomIds: string[];

  @ValidateIf((o: BulkAssignDto) => o.assigneeId !== null)
  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;
}
