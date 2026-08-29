import { Module } from '@nestjs/common';
import { RenditionService } from './rendition.service';

// STORAGE_DRIVER comes from the @Global() StorageModule — no import needed.
@Module({
  providers: [RenditionService],
  exports: [RenditionService],
})
export class RenditionsModule {}
