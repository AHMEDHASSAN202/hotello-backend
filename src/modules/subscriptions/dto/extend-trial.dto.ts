import { IsInt, IsPositive } from 'class-validator';

export class ExtendTrialDto {
  @IsInt()
  @IsPositive()
  additionalDays: number;
}
