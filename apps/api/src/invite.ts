import { PrismaClient } from "@prisma/client";

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
  console.error("Usage: pnpm invite:add person@example.com");
  process.exit(1);
}
const prisma = new PrismaClient();
await prisma.invite.upsert({ where: { email }, update: {}, create: { email } });
console.info(`Invited ${email}`);
await prisma.$disconnect();
