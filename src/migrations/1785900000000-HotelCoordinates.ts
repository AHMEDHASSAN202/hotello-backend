import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hotel address coordinates. The Super Admin dashboard now fills the address
 * exclusively from a Google Places selection, which carries lat/lng — stored
 * alongside the address text for later use (maps, guest-app directions).
 * Nullable: hotels onboarded before this feature keep address-only rows until
 * their address is re-selected.
 */
export class HotelCoordinates1785900000000 implements MigrationInterface {
  name = 'HotelCoordinates1785900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "hotels" ADD "latitude" double precision
    `);
    await queryRunner.query(`
      ALTER TABLE "hotels" ADD "longitude" double precision
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "hotels" DROP COLUMN "longitude"
    `);
    await queryRunner.query(`
      ALTER TABLE "hotels" DROP COLUMN "latitude"
    `);
  }
}
