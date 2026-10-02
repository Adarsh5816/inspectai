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

  // Create sample manager
  const manager = await prisma.user.upsert({
    where: { email: 'manager@inspectai.com' },
    update: {},
    create: {
      email: 'manager@inspectai.com',
      passwordHash: 'manager123',
      fullName: 'Operations Manager',
      role: 'MANAGER',
      organization: 'Intertek',
    },
  });

  // Create sample field staff (reporting to manager)
  const inspector = await prisma.user.upsert({
    where: { email: 'inspector@inspectai.com' },
    update: {},
    create: {
      email: 'inspector@inspectai.com',
      passwordHash: 'inspector123',
      fullName: 'Field Inspector (Adarsh MS)',
      role: 'INSPECTOR',
      managerId: manager.id,
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

  // Assign team members to sample project
  for (const uid of [admin.id, manager.id, inspector.id]) {
    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: uid } },
      update: {},
      create: { projectId: project.id, userId: uid },
    });
  }

  console.log(`✅ Seed completed: Admin=${admin.email}, Manager=${manager.email}, Inspector=${inspector.email}, Project=${project.projectNumber}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
