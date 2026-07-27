import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { Admin } from '../../modules/admins/admin.entity';
import { AuditLog } from '../../modules/audit-logs/audit-log.entity';
import { Hotel } from '../../modules/hotels/hotel.entity';
import { ALL_MODULE_KEYS } from '../../modules/plans/modules.constants';
import { Plan } from '../../modules/plans/plan.entity';
import { WILDCARD } from '../../modules/roles/permissions.constants';
import { Role } from '../../modules/roles/role.entity';
import { Subscription } from '../../modules/subscriptions/subscription.entity';
import { TenantUser } from '../../modules/tenant-users/tenant-user.entity';

config();

const SUPER_ADMIN_ROLE = 'Super Admin';

async function seed() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USER ?? 'hotello',
    password: process.env.DB_PASSWORD ?? 'hotello',
    database: process.env.DB_NAME ?? 'hotello',
    entities: [Admin, Role, Plan, Hotel, Subscription, AuditLog, TenantUser],
    synchronize: true,
  });
  await dataSource.initialize();

  const rolesRepo = dataSource.getRepository(Role);
  const adminsRepo = dataSource.getRepository(Admin);

  let role = await rolesRepo.findOne({ where: { name: SUPER_ADMIN_ROLE } });
  if (!role) {
    role = await rolesRepo.save(
      rolesRepo.create({
        name: SUPER_ADMIN_ROLE,
        description: 'Full platform access',
        permissions: [WILDCARD],
        isSystem: true,
      }),
    );
    console.log(`Created system role "${SUPER_ADMIN_ROLE}" with ['*']`);
  } else {
    console.log(`Role "${SUPER_ADMIN_ROLE}" already exists — skipping`);
  }

  const email = (process.env.SEED_ADMIN_EMAIL ?? '').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set');
  }

  const existing = await adminsRepo.findOne({ where: { email } });
  if (!existing) {
    await adminsRepo.save(
      adminsRepo.create({
        name: process.env.SEED_ADMIN_NAME ?? 'Super Admin',
        email,
        passwordHash: await bcrypt.hash(password, 10),
        roleId: role.id,
        isActive: true,
      }),
    );
    console.log(`Created admin ${email}`);
  } else {
    console.log(`Admin ${email} already exists — skipping`);
  }

  // Launch plans (SA-PLAN: Stories 4.8 + 4.9) — find-or-create by nameEn.
  const plansRepo = dataSource.getRepository(Plan);
  const launchPlans: Array<Partial<Plan>> = [
    {
      nameEn: 'Standard',
      nameAr: 'الأساسية',
      descriptionEn: 'The default launch plan — all modules, no limits.',
      descriptionAr: 'الخطة الافتراضية للإطلاق — جميع الوحدات بلا حدود.',
      monthlyPrice: Number(process.env.SEED_STANDARD_PRICE ?? 0),
      yearlyPrice: null,
      currency: 'EGP',
      maxRooms: null,
      maxStaffUsers: null,
      maxGuestRequestsPerMonth: null,
      enabledModules: ALL_MODULE_KEYS,
      status: 'active',
      isTrial: false,
      trialDurationDays: null,
    },
    {
      nameEn: 'Free Trial',
      nameAr: 'التجربة المجانية',
      descriptionEn: 'Full platform access for 14 days.',
      descriptionAr: 'وصول كامل للمنصة لمدة ١٤ يومًا.',
      monthlyPrice: 0,
      yearlyPrice: null,
      currency: 'EGP',
      maxRooms: null,
      maxStaffUsers: null,
      maxGuestRequestsPerMonth: null,
      enabledModules: ALL_MODULE_KEYS,
      status: 'active',
      isTrial: true,
      trialDurationDays: 14,
    },
  ];
  for (const planData of launchPlans) {
    const existingPlan = await plansRepo.findOne({
      where: { nameEn: planData.nameEn },
    });
    if (!existingPlan) {
      await plansRepo.save(plansRepo.create(planData));
      console.log(`Created plan "${planData.nameEn}"`);
    } else {
      console.log(`Plan "${planData.nameEn}" already exists — skipping`);
    }
  }

  // Dev-only demo hotel for manual subscription flows (no Hotels UI yet).
  // Counters sized to trip the downgrade guards in manual testing.
  if (process.env.SEED_DEMO_HOTEL === 'true') {
    const hotelsRepo = dataSource.getRepository(Hotel);
    const demoSlug = 'demo-hotel';
    const existingHotel = await hotelsRepo.findOne({
      where: { slug: demoSlug },
    });
    if (!existingHotel) {
      await hotelsRepo.save(
        hotelsRepo.create({
          nameEn: 'Demo Hotel',
          nameAr: 'فندق تجريبي',
          slug: demoSlug,
          city: 'Cairo',
          contactEmail: 'manager@demo-hotel.example',
          contactPhone: '+20 100 000 0000',
          roomsCount: 80,
          staffUsersCount: 12,
          monthlyGuestRequests: 500,
        }),
      );
      console.log(`Created "Demo Hotel" (${demoSlug})`);
    } else {
      console.log(`"Demo Hotel" already exists — skipping`);
    }
  }

  await dataSource.destroy();
  console.log('Seed complete.');
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
