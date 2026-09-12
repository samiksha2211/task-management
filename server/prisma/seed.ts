import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminPassword = await bcrypt.hash("admin123", 10);

  await prisma.user.upsert({
    where: { email: "admin@railwork.com" },
    update: { designation: "DRM" },
    create: {
      name: "DRM",
      email: "admin@railwork.com",
      password: adminPassword,
      designation: "DRM",
      role: Role.ADMIN,
    },
  });

  console.log("Seeded admin (DRM). Record keeping is designation-based.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });