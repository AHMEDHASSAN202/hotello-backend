import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  FNB_ORDER_STATUSES,
  FnbCancelReason,
  FnbOrderStatus,
  STAFF_FNB_CANCEL_REASONS,
} from '../fnb.constants';

/** 16.7 AC1/AC3 — board (delta-polled) + history with filters. */
export class ListTenantFnbOrdersQueryDto {
  @IsOptional()
  @IsIn(['open', 'history'])
  tab?: 'open' | 'history' = 'open';

  @IsOptional()
  @IsISO8601()
  updatedSince?: string;

  @IsOptional()
  @IsIn(FNB_ORDER_STATUSES as unknown as string[])
  status?: FnbOrderStatus;

  @IsOptional()
  @IsUUID()
  menuId?: string;

  /** 'room' or a location uuid — the destination-zone filter (AC3). */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  destination?: string;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @IsIn(['1'])
  overdue?: '1';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 20;
}

/** 16.7 AC2 — staff cancel with reason; note required for 'other'. */
export class CancelFnbOrderDto {
  @IsIn(STAFF_FNB_CANCEL_REASONS as unknown as string[])
  reason: FnbCancelReason;

  @ValidateIf((o) => o.reason === 'other')
  @IsString()
  @IsNotEmpty({ message: 'A note is required when the reason is "other"' })
  @MaxLength(300)
  note?: string;
}

export class AssignFnbOrderDto {
  /** null unassigns (requests parity). */
  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;
}

/** 16.8 AC2 — bulk settle; omitted ids = everything unsettled on the stay. */
export class SettleFnbOrdersDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  orderIds?: string[];
}
