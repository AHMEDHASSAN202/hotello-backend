import { Type } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';

class PushKeysDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  p256dh: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  auth: string;
}

/** Epic 23, Story 23.1/23.2 — browser subscribe payload from the PushSubscription W3C API. */
export class SubscribePushDto {
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(1000)
  endpoint: string;

  @IsObject()
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys: PushKeysDto;

  @IsOptional()
  @IsIn(['ios-pwa', 'android', 'desktop', 'other'])
  deviceHint?: string;
}

export class UnsubscribePushDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  endpoint: string;
}
