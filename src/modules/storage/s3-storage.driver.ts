import { NotFoundException } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  EXTENSION_CONTENT_TYPES,
  StorageDriver,
  StoredObject,
} from './storage.interface';

export interface S3DriverOptions {
  endpoint?: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export class S3StorageDriver implements StorageDriver {
  private readonly client: S3Client;

  constructor(private readonly options: S3DriverOptions) {
    this.client = new S3Client({
      region: options.region,
      // Custom endpoint enables S3-compatible providers (MinIO, DO Spaces…).
      ...(options.endpoint
        ? { endpoint: options.endpoint, forcePathStyle: true }
        : {}),
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<StoredObject> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
      );
      const data = Buffer.from(await result.Body!.transformToByteArray());
      const ext = key.split('.').pop()?.toLowerCase() ?? '';
      return {
        data,
        contentType:
          result.ContentType ??
          EXTENSION_CONTENT_TYPES[ext] ??
          'application/octet-stream',
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      throw new NotFoundException('File not found');
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }),
    );
  }
}
