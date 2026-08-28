import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

/** 20.3 AC1 — assign/reassign; explicit null unassigns. */
export class AssignRoomDto {
  @ValidateIf((o: AssignRoomDto) => o.assigneeId !== null)
  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;
}
