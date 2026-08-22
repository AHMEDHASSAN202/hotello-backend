import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

/** 15.5 AC2 — assign/reassign; explicit null unassigns. */
export class AssignRequestDto {
  @ValidateIf((o: AssignRequestDto) => o.assigneeId !== null)
  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;
}
