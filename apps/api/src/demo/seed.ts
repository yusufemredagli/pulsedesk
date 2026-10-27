import 'reflect-metadata';
import { config } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { assertDemoEnvironment, DemoSeedError, seedDemo } from './seed-demo';
import { DEMO_PASSWORD, DEMO_USERS } from './manifest';
export async function main(): Promise<void> {
  // Refuse exported production mode before even loading local environment files.
  if (process.env.NODE_ENV === 'production')
    throw new DemoSeedError('Production demo seeding is forbidden.');
  config({ path: ['.env', '../../.env'], quiet: true });
  assertDemoEnvironment(process.env);
  const db = new PrismaService(
    new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }),
  );
  try {
    await db.onModuleInit();
    const result = await seedDemo(db, process.env);
    console.log(
      'PulseDesk demo environment ready.\nLOCAL DEVELOPMENT / DEMO ONLY — never production credentials.\n\nDemo users:',
    );
    for (const user of DEMO_USERS)
      console.log(`${user.role.padEnd(8)} ${user.email}`);
    console.log(
      `\nPassword: ${DEMO_PASSWORD}\nOrganization: PulseDesk Demo\nTickets created: ${result.createdTickets}; existing demo data preserved.`,
    );
  } finally {
    await db.onApplicationShutdown();
  }
}
if (require.main === module)
  void main().catch((error: unknown) => {
    console.error(
      error instanceof DemoSeedError
        ? error.message
        : 'Demo seed failed. Check local database availability, migrations and demo identity/policy conflicts. No partial seed changes were committed.',
    );
    process.exitCode = 1;
  });
