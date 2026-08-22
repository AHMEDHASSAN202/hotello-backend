import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

/** 15.1 AC2 — new order within one category; index becomes sortOrder. */
export class ReorderItemsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  itemIds: string[];
}
