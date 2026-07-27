import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FilesController } from './files.controller';
import { LocalStorageDriver } from './local-storage.driver';
import { S3StorageDriver } from './s3-storage.driver';
import { STORAGE_DRIVER } from './storage.interface';

/**
 * Global so future upload features (guest documents, service images…) inject
 * STORAGE_DRIVER without re-importing. Driver selection is env-only.
 */
@Global()
@Module({
  controllers: [FilesController],
  providers: [
    {
      provide: STORAGE_DRIVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        if (config.get('STORAGE_DRIVER', 'local') === 's3') {
          return new S3StorageDriver({
            endpoint: config.get('S3_ENDPOINT') || undefined,
            bucket: config.getOrThrow('S3_BUCKET'),
            region: config.getOrThrow('S3_REGION'),
            accessKeyId: config.getOrThrow('S3_ACCESS_KEY'),
            secretAccessKey: config.getOrThrow('S3_SECRET_KEY'),
          });
        }
        return new LocalStorageDriver(config.get('UPLOADS_PATH', './uploads'));
      },
    },
  ],
  exports: [STORAGE_DRIVER],
})
export class StorageModule {}
