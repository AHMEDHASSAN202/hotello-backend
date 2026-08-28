import { Matches } from 'class-validator';
import { CHECKOUT_TIME_REGEX } from '../../tenant-stays/stays.constants';

/** 20.1 AC4 — hotel-local daily service hour ('HH:MM', same regex as checkout). */
export class UpdateHousekeepingSettingsDto {
  @Matches(CHECKOUT_TIME_REGEX, {
    message: 'dailyServiceTime must be HH:MM (24-hour)',
  })
  dailyServiceTime: string;
}
