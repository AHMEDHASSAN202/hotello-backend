import { IsIn, Matches, ValidateIf } from 'class-validator';
import { REPORT_PRESETS, ReportPreset } from '../reports-period';

export class ReportPeriodDto {
  @IsIn(REPORT_PRESETS)
  preset: ReportPreset;

  @ValidateIf((o: ReportPeriodDto) => o.preset === 'custom')
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ValidateIf((o: ReportPeriodDto) => o.preset === 'custom')
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}
