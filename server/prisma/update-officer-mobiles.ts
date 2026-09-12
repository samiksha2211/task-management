import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

const prisma = new PrismaClient();

const officers = [
  { designation: "DRM", mobileNumber: "9794837000" },
  { designation: "ADRM/OP", mobileNumber: "9794837001" },
  { designation: "ADRM/G", mobileNumber: "9794837002" },
  { designation: "ADRM/Infra", mobileNumber: "9794837003" },
  { designation: "Dy.CTM/CNB", mobileNumber: "9794837951" },
  { designation: "SD/PRYJ", mobileNumber: "9794837905" },
  { designation: "PS-1", mobileNumber: "9794837004" },
  { designation: "RAJBHASHA ADHIKARI", mobileNumber: "9794837102" },


  { designation: "Sr.DEN/CO", mobileNumber: "9794837200" },
  { designation: "Sr.DEN/I", mobileNumber: "9794837201" },
  { designation: "Sr.DEN/II", mobileNumber: "9794837202" },
  { designation: "Sr.DEN/III", mobileNumber: "9794837203" },
  { designation: "Sr.DEN/IV", mobileNumber: "9794837204" },
  { designation: "Sr.DEN/V", mobileNumber: "9794837205" },
  { designation: "Sr.DEN/ESTATE", mobileNumber: "9794837211" },
  { designation: "Sr.DEN/TRACK", mobileNumber: "9794837206" },

  { designation: "PRO/PRYJ", mobileNumber: "9794866933" },
  { designation: "Sr.DCM/Coaching", mobileNumber: "9794837950" },
  { designation: "Sr.DCM/Freight", mobileNumber: "9794837952" },

  { designation: "Sr.DOM/Co-ord", mobileNumber: "9794837900" },
  { designation: "Sr.DOM/G&G", mobileNumber: "9794837902" },

  { designation: "Sr.DEE/G", mobileNumber: "9794837302" },
  { designation: "Sr.DEE/OP", mobileNumber: "9794837301" },
  { designation: "Sr.DEE/Coaching", mobileNumber: "9794837308" },
  { designation: "Sr.DEE/TRD", mobileNumber: "9794837300" },
  { designation: "Sr.DEE/TRS/CNB", mobileNumber: "9794837305" },
  { designation: "Sr.DEE/TMS/CNB", mobileNumber: "9794837304" },

  { designation: "Principal/ETC/CNB", mobileNumber: "9794837315" },

  { designation: "Sr.DAuo", mobileNumber: "9794837518" },
  { designation: "Sr.DEnHM", mobileNumber: "9794837051" },

  { designation: "Sr.DME/O&F", mobileNumber: "9794837400" },
  { designation: "Sr.DME/Coaching", mobileNumber: "9794837401" },

  { designation: "Sr.DSTE/Co-ord", mobileNumber: "9794837800" },
  { designation: "Sr.DSTE/Signal/PRYJ", mobileNumber:"9794837802" },
  { designation: "Sr.DSTE/CNB", mobileNumber: "9794837801" },
  { designation: "Sr.DSTE/ALJN", mobileNumber: "9794837804" },

  { designation: "Sr.DPO", mobileNumber: "9794837600"},
  { designation: "Sr.DFM", mobileNumber: "9794837100" },

  { designation: "CMS", mobileNumber: "9794837500" },
  { designation: "Sr.DMM", mobileNumber: "9794837770" },
  { designation: "Sr.DSC", mobileNumber: "9794837700" },
  { designation: "Sr.DSO", mobileNumber: "9794837021" },

  { designation: "Senior Clerk", mobileNumber: "7011692331" },
  { designation: "JE/Tele", mobileNumber: "8604779731" },

];
function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
async function main() {
  let updated = 0;
  let created = 0;

  for (const officer of officers) {
    const existing = await prisma.user.findFirst({
      where: {
        designation: {
          equals: officer.designation,
          mode: "insensitive",
        },
      },
    });

    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          mobileNumber: officer.mobileNumber,
        },
      });

      console.log(
        `✅ Updated: ${existing.designation} -> ${officer.mobileNumber}`
      );

      updated++;
      continue;
    }

    const slug = slugify(officer.designation) || "officer";

    let email = `${slug}@railwork.local`;
    let counter = 1;

    while (
      await prisma.user.findUnique({
        where: { email },
      })
    ) {
      email = `${slug}-${counter}@railwork.local`;
      counter++;
    }
const existingMobile = await prisma.user.findUnique({
  where: {
    mobileNumber: officer.mobileNumber,
  },
});

if (existingMobile) {
  console.log(
    `⚠️ Mobile already used: ${officer.mobileNumber} -> ${existingMobile.designation}`
  );
  continue;
}

    const randomPassword = crypto.randomUUID();

    const user = await prisma.user.create({
      data: {
        name: officer.designation,
        designation: officer.designation,
        email,
        password: await bcrypt.hash(randomPassword, 10),
        role: "OFFICER",
        isActive: true,
        mobileNumber: officer.mobileNumber,
      },
    });

    console.log(
      `➕ Created: ${user.designation} -> ${officer.mobileNumber}`
    );

    created++;
  }

  console.log("");
  console.log(`Updated existing officers: ${updated}`);
  console.log(`Created missing officers: ${created}`);
}
main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });