import { IsIn, IsOptional } from 'class-validator';

export class ListPlansQueryDto {
  @IsOptional()
  @IsIn(['active', 'archived', 'all'])
  status?: 'active' | 'archived' | 'all';

  @IsOptional()
  @IsIn(['name', 'monthlyPrice', 'subscriberCount', 'createdAt'])
  sortBy?: 'name' | 'monthlyPrice' | 'subscriberCount' | 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';
}
