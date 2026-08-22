import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  ValidateNested,
} from 'class-validator';
import {
  FNB_DESTINATION_TYPES,
  FNB_MAX_LINE_QUANTITY,
  FNB_MAX_ORDER_LINES,
  FNB_MAX_SPOT_LENGTH,
  FNB_PAYMENT_METHODS,
  FnbDestinationType,
  FnbPaymentMethod,
} from '../fnb.constants';

export class GuestFnbOrderLineDto {
  @IsUUID()
  itemId: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  variantKey?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(FNB_MAX_LINE_QUANTITY)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class GuestFnbDestinationDto {
  @IsIn(FNB_DESTINATION_TYPES as unknown as string[])
  type: FnbDestinationType;

  @ValidateIf((o) => o.type === 'location')
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(FNB_MAX_SPOT_LENGTH)
  spot?: string;
}

/** 16.5 AC4 — the order POST; identity (stay/room/hotel) is the JWT's. */
export class CreateGuestFnbOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(FNB_MAX_ORDER_LINES)
  @ValidateNested({ each: true })
  @Type(() => GuestFnbOrderLineDto)
  lines: GuestFnbOrderLineDto[];

  @ValidateNested()
  @Type(() => GuestFnbDestinationDto)
  destination: GuestFnbDestinationDto;

  /** Required only when the paid total is > 0 (checked in the service). */
  @IsOptional()
  @IsIn(FNB_PAYMENT_METHODS as unknown as string[])
  paymentMethod?: FnbPaymentMethod;
}

export class ListGuestFnbOrdersQueryDto {
  @IsOptional()
  @IsISO8601()
  updatedSince?: string;
}
