import { IsUUID } from 'class-validator';

/** 13.3 AC2 — move the stay to another available room. */
export class ChangeRoomDto {
  @IsUUID()
  roomId: string;
}
