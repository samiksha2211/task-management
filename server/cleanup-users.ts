import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const demo = await prisma.user.findMany({
    where: { name: { in: ["Aleena"] } },
  });
  if (demo.length === 0) {
    console.log("No demo officer found.");
    return;
  }

  const admin = await prisma.user.update({
    where: { email: "admin@railwork.com" },
    data: { designation: "DRM" },
  });

  const oldIds = demo.map((u) => u.id);
  const reassigned = await prisma.task.updateMany({
    where: { officerId: { in: oldIds } },
    data: { officerId: admin.id },
  });
  await prisma.user.deleteMany({ where: { id: { in: oldIds } } });

  console.log(
    `Deleted ${demo.length} officer(s); reassigned ${reassigned.count} tasks.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());