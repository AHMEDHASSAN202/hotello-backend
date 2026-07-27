import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';

export class ChangeSubscriptionDto {
  @IsUUID()
  planId: string;

  @IsIn(['monthly', 'yearly'])
  billingCycle: 'monthly' | 'yearly';

  /** Wildcard-only override of downgrade/trial-reuse guards; audit-logged. */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
