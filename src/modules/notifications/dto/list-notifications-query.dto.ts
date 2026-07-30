import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import {
  NOTIFICATION_STATUSES,
  NOTIFICATION_TYPES,
  NotificationStatus,
  NotificationType,
} from '../notifications.constants';

export class ListNotificationsQueryDto {
  @IsOptional()
  @IsIn(NOTIFICATION_STATUSES)
  status?: NotificationStatus;

  @IsOptional()
  @IsIn(NOTIFICATION_TYPES)
  type?: NotificationType;

  @IsOptional()
  @IsUUID()
  hotelId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  /** Matches recipient name or email (Story 6.7 AC2). */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 20;
}
