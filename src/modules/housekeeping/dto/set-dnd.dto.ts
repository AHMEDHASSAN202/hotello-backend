import { IsBoolean } from 'class-validator';

/** 20.4 AC1 — the guest DND switch payload. */
export class SetDndDto {
  @IsBoolean()
  active: boolean;
}
