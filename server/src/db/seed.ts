import prisma from './prisma';

async function main() {
  // Create admin user
  const admin = await prisma.user.upsert({
    where: { email: 'admin@inspectai.com' },
    update: {},
    create: {
      email: 'admin@inspectai.com',
      passwordHash: 'admin123',
      fullName: 'Admin User',
      role: 'ADMIN',
      organization: 'Intertek',
    },
  });

  // Create the real project
  const project = await prisma.project.upsert({
    where: { projectNumber: 'P30339B' },
    update: {
      projectName: 'EPC for SE AiP5 Project (On plot) - ASAB/SAHIL (Package 1)',
      customerName: 'ADNOC Onshore',
      customerAddress: 'P.O. Box 270, Abu Dhabi, UAE',
      epcContractor: 'Archirodon',
      supplierName: 'KSB MIL Controls Limited',
      supplierAddress: 'Meladoor, Annamanada - 680741, Kerala, India',
      subSupplierName: 'Specialised Coating Services',
      poNumber: '04108-PM-INST-008',
    },
    create: {
      projectNumber: 'P30339B',
      projectName: 'EPC for SE AiP5 Project (On plot) - ASAB/SAHIL (Package 1)',
      customerName: 'ADNOC Onshore',
      customerAddress: 'P.O. Box 270, Abu Dhabi, UAE',
      epcContractor: 'Archirodon',
      supplierName: 'KSB MIL Controls Limited',
      supplierAddress: 'Meladoor, Annamanada - 680741, Kerala, India',
      subSupplierName: 'Specialised Coating Services',
      poNumber: '04108-PM-INST-008',
      createdById: admin.id,
    },
  });

  console.log(`✅ Seed completed: Admin=${admin.email}, Project=${project.projectNumber}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
