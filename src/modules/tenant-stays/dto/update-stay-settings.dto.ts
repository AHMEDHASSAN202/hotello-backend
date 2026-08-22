import { IsIn, IsOptional, Matches } from 'class-validator';
import {
  CHECKOUT_TIME_REGEX,
  STAY_TYPES,
  StayType,
} from '../stays.constants';

/** 13.4 AC2 — hotel-local checkout hour; 16.1 AC2 — default stay type. */
export class UpdateStaySettingsDto {
  @Matches(CHECKOUT_TIME_REGEX, {
    message: 'checkoutTime must be HH:MM (24-hour)',
  })
  checkoutTime: string;

  @IsOptional()
  @IsIn(STAY_TYPES as unknown as string[])
  defaultStayType?: StayType;
}
