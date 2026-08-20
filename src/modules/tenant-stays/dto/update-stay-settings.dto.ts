import { Matches } from 'class-validator';
import { CHECKOUT_TIME_REGEX } from '../stays.constants';

/** 13.4 AC2 — hotel-local checkout hour. */
export class UpdateStaySettingsDto {
  @Matches(CHECKOUT_TIME_REGEX, {
    message: 'checkoutTime must be HH:MM (24-hour)',
  })
  checkoutTime: string;
}
