import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { FNB_PAYMENT_METHODS, FnbPaymentMethod } from '../../fnb/fnb.constants';
import { EVENT_BOOKING_MAX_PARTY_SIZE } from '../events.constants';

/**
 * Story 21.4 — `POST /guest/events/:id/book` body. The event id always
 * comes from the route param (`:id`), never duplicated in the body — the
 * "never trust client-sent ids" rule applies to which event the write
 * targets just as much as to hotel/stay scoping.
 */
export class BookEventDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(EVENT_BOOKING_MAX_PARTY_SIZE)
  partySize: number;

  /** Required only when the resolved price is > 0 (checked in the service). */
  @IsOptional()
  @IsIn(FNB_PAYMENT_METHODS as unknown as string[])
  paymentMethod?: FnbPaymentMethod;
}
