import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Clear existing data (in development only)
  if (process.env.NODE_ENV !== 'production') {
    console.log('🗑️  Clearing existing data...');
    await prisma.payout.deleteMany();
    await prisma.verification.deleteMany();
    await prisma.verificationCode.deleteMany();
    await prisma.qRCode.deleteMany();
    await prisma.invoice.deleteMany();
    await prisma.supportTicket.deleteMany();
    await prisma.paymentMethod.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.location.deleteMany();
    await prisma.partner.deleteMany();
    await prisma.plan.deleteMany();
    await prisma.user.deleteMany();
    console.log('✅ Cleared existing data');
  }

  // Create subscription plans with new wash type structure
  // CAR PLANS
  const carBasePlan = await prisma.plan.create({
    data: {
      name: 'Car Base Plan',
      description: '1 In & Out + 1 Outside Only wash per month',
      price: 15,
      duration: 30,
      vehicleType: 'CAR',
      tier: 'BASE',
      inAndOutQuota: 1,
      outsideOnlyQuota: 1,
      inAndOutPayout: 10.00,
      outsideOnlyPayout: 8.00,
      active: true,
    },
  });

  const carStandardPlan = await prisma.plan.create({
    data: {
      name: 'Car Standard Plan',
      description: '3 In & Out washes per month',
      price: 25,
      duration: 30,
      vehicleType: 'CAR',
      tier: 'STANDARD',
      inAndOutQuota: 3,
      outsideOnlyQuota: 0,
      inAndOutPayout: 10.00,
      outsideOnlyPayout: null,
      active: true,
    },
  });

  const carPremiumPlan = await prisma.plan.create({
    data: {
      name: 'Car Premium Plan',
      description: '6 In & Out washes per month',
      price: 60,
      duration: 30,
      vehicleType: 'CAR',
      tier: 'PREMIUM',
      inAndOutQuota: 6,
      outsideOnlyQuota: 0,
      inAndOutPayout: 9.00,
      outsideOnlyPayout: null,
      active: true,
    },
  });

  // TAXI PLANS
  const taxiStandardPlan = await prisma.plan.create({
    data: {
      name: 'Taxi Standard Plan',
      description: '4 In & Out washes per month',
      price: 30,
      duration: 30,
      vehicleType: 'TAXI',
      tier: 'STANDARD',
      inAndOutQuota: 4,
      outsideOnlyQuota: 0,
      inAndOutPayout: 9.00,
      outsideOnlyPayout: null,
      active: true,
    },
  });

  const taxiPremiumPlan = await prisma.plan.create({
    data: {
      name: 'Taxi Premium Plan',
      description: '6 In & Out washes per month',
      price: 70,
      duration: 30,
      vehicleType: 'TAXI',
      tier: 'PREMIUM',
      inAndOutQuota: 6,
      outsideOnlyQuota: 0,
      inAndOutPayout: 10.00,
      outsideOnlyPayout: null,
      active: true,
    },
  });

  // VAN PLANS
  const vanBasePlan = await prisma.plan.create({
    data: {
      name: 'Van Base Plan',
      description: '1 In & Out + 1 Outside Only wash per month',
      price: 20,
      duration: 30,
      vehicleType: 'VAN',
      tier: 'BASE',
      inAndOutQuota: 1,
      outsideOnlyQuota: 1,
      inAndOutPayout: 12.00,
      outsideOnlyPayout: 12.00,
      active: true,
    },
  });

  const vanStandardPlan = await prisma.plan.create({
    data: {
      name: 'Van Standard Plan',
      description: '3 In & Out washes per month',
      price: 35,
      duration: 30,
      vehicleType: 'VAN',
      tier: 'STANDARD',
      inAndOutQuota: 3,
      outsideOnlyQuota: 0,
      inAndOutPayout: 14.00,
      outsideOnlyPayout: null,
      active: true,
    },
  });

  const vanPremiumPlan = await prisma.plan.create({
    data: {
      name: 'Van Premium Plan',
      description: '6 In & Out washes per month',
      price: 85,
      duration: 30,
      vehicleType: 'VAN',
      tier: 'PREMIUM',
      inAndOutQuota: 6,
      outsideOnlyQuota: 0,
      inAndOutPayout: 13.00,
      outsideOnlyPayout: null,
      active: true,
    },
  });

  console.log(`✅ Created 8 subscription plans with wash types and vehicle types`);

  // Create Extra Services
  const extraWashInAndOut = await prisma.extraService.create({
    data: {
      name: 'Extra In & Out Wash',
      description: 'One-time In & Out wash when you are out of quota',
      price: 12.00,
      type: 'IN_AND_OUT',
      active: true,
    },
  });

  const extraWashOutside = await prisma.extraService.create({
    data: {
      name: 'Extra Outside Only Wash',
      description: 'One-time Outside Only wash when you are out of quota',
      price: 8.00,
      type: 'OUTSIDE_ONLY',
      active: true,
    },
  });

  console.log(`✅ Created 2 extra services`);

  // Create admin users
  const adminUser = await prisma.user.create({
    data: {
      name: 'Admin User',
      email: 'info@bellacarwash.co.uk',
      password: await bcrypt.hash('Admin123!', 12),
      role: 'ADMIN',
      phone: '+44 20 9999 0001',
    },
  });

  const superAdmin = await prisma.user.create({
    data: {
      name: 'Super Admin',
      email: 'adnan99mahmud@gmail.com',
      password: await bcrypt.hash('Adnan123!', 12),
      role: 'ADMIN',
      phone: '+44 20 9999 0002',
    },
  });

  console.log(`✅ Created 2 admin users (IDs: ${adminUser.id}, ${superAdmin.id})`);
  console.log(`   - Email: info@bellacarwash.co.uk | Password: Admin123!`);
  console.log(`   - Email: adnan99mahmud@gmail.com | Password: Adnan123!`);

  // Create test users
  const testUser1 = await prisma.user.create({
    data: {
      name: 'John Doe',
      email: 'john@example.com',
      password: await bcrypt.hash('User123!', 12),
      role: 'USER',
      phone: '+44 20 8888 0001',
    },
  });

  const testUser2 = await prisma.user.create({
    data: {
      name: 'Jane Smith',
      email: 'jane@example.com',
      password: await bcrypt.hash('User123!', 12),
      role: 'USER',
      phone: '+44 20 8888 0002',
    },
  });

  const testUser3 = await prisma.user.create({
    data: {
      name: 'Mike Johnson',
      email: 'mike@example.com',
      password: await bcrypt.hash('User123!', 12),
      role: 'USER',
      phone: '+44 20 8888 0003',
    },
  });

  console.log(`✅ Created 3 test users (IDs: ${testUser1.id}, ${testUser2.id}, ${testUser3.id})`);

  // Create subscriptions for test users
  const subscription1 = await prisma.subscription.create({
    data: {
      userId: testUser1.id,
      planId: carPremiumPlan.id,
      status: 'ACTIVE',
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      inAndOutWashesUsed: 2,
      outsideOnlyWashesUsed: 0,
    },
  });

  const subscription2 = await prisma.subscription.create({
    data: {
      userId: testUser2.id,
      planId: carStandardPlan.id,
      status: 'ACTIVE',
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      inAndOutWashesUsed: 1,
      outsideOnlyWashesUsed: 0,
    },
  });

  const subscription3 = await prisma.subscription.create({
    data: {
      userId: testUser3.id,
      planId: carBasePlan.id,
      status: 'ACTIVE',
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      inAndOutWashesUsed: 1,
      outsideOnlyWashesUsed: 1,
    },
  });

  console.log(`✅ Created 3 subscriptions for test users`);

  // Create sample invoices
  const invoice1 = await prisma.invoice.create({
    data: {
      subscriptionId: subscription1.id,
      stripeInvoiceId: 'in_test_' + Math.random().toString(36).substr(2, 9),
      amount: carPremiumPlan.price,
      status: 'PAID',
      dueDate: new Date(),
      paidAt: new Date(),
    },
  });

  const invoice2 = await prisma.invoice.create({
    data: {
      subscriptionId: subscription2.id,
      stripeInvoiceId: 'in_test_' + Math.random().toString(36).substr(2, 9),
      amount: carStandardPlan.price,
      status: 'PAID',
      dueDate: new Date(),
      paidAt: new Date(),
    },
  });

  const invoice3 = await prisma.invoice.create({
    data: {
      subscriptionId: subscription3.id,
      stripeInvoiceId: 'in_test_' + Math.random().toString(36).substr(2, 9),
      amount: carBasePlan.price,
      status: 'PENDING',
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
      paidAt: null,
    },
  });

  console.log(`✅ Created 3 sample invoices`);

  // Create partners
  const partner1 = await prisma.partner.create({
    data: {
      name: 'Sparkle Car Wash',
      password: await bcrypt.hash('SecurePass123!', 12),
      email: 'partner1@example.com',
      phone: '+44 20 1234 5678',
      status: 'ACTIVE',
    },
  });

  const partner2 = await prisma.partner.create({
    data: {
      name: 'Crystal Clean Wash',
      password: await bcrypt.hash('AnotherSecurePass456!', 12),
      email: 'partner2@example.com',
      phone: '+44 20 2345 6789',
      status: 'ACTIVE',
    },
  });

  const partner3 = await prisma.partner.create({
    data: {
      name: 'Shine & Polish',
      password: await bcrypt.hash('YetAnotherPass789!', 12),
      email: 'partner3@example.com',
      phone: '+44 20 3456 7890',
      status: 'ACTIVE',
    },
  });

  console.log(`✅ Created 3 partners (IDs: ${partner1.id}, ${partner2.id}, ${partner3.id})`);

  // Create locations
  const locations = await Promise.all([
    // Sparkle Car Wash locations
    prisma.location.create({
      data: {
        partnerId: partner1.id,
        name: 'Sparkle Car Wash - High Street',
        postcode: 'SW1A 1AA',
        addressLine1: '123 High Street',
        city: 'London',
        county: 'Greater London',
        country: 'United Kingdom',
        latitude: 51.5074,
        longitude: -0.1278,
        phone: '+44 20 1234 5678',
        hours: 'Mon-Sun 8AM-8PM',
        isPrimary: true,
        active: true,
      },
    }),
    prisma.location.create({
      data: {
        partnerId: partner1.id,
        name: 'Sparkle Car Wash - King\'s Road',
        postcode: 'SW3 5UL',
        addressLine1: '456 King\'s Road',
        city: 'London',
        county: 'Greater London',
        country: 'United Kingdom',
        latitude: 51.4928,
        longitude: -0.1647,
        phone: '+44 20 1234 5679',
        hours: 'Mon-Sun 7AM-9PM',
        active: true,
      },
    }),
    // Crystal Clean Wash locations
    prisma.location.create({
      data: {
        partnerId: partner2.id,
        name: 'Crystal Clean - Oxford Street',
        postcode: 'W1C 1JN',
        addressLine1: '789 Oxford Street',
        city: 'London',
        county: 'Greater London',
        country: 'United Kingdom',
        latitude: 51.5155,
        longitude: -0.1426,
        phone: '+44 20 2345 6789',
        hours: 'Mon-Fri 7AM-10PM, Sat-Sun 8AM-9PM',
        isPrimary: true,
        active: true,
      },
    }),
    prisma.location.create({
      data: {
        partnerId: partner2.id,
        name: 'Crystal Clean - Camden',
        postcode: 'NW1 7JN',
        addressLine1: '321 Camden High Street',
        city: 'London',
        county: 'Greater London',
        country: 'United Kingdom',
        latitude: 51.5392,
        longitude: -0.1426,
        phone: '+44 20 2345 6790',
        hours: 'Mon-Sun 8AM-8PM',
        active: true,
      },
    }),
    // Shine & Polish locations
    prisma.location.create({
      data: {
        partnerId: partner3.id,
        name: 'Shine & Polish - Canary Wharf',
        postcode: 'E14 5AB',
        addressLine1: '654 Canada Square',
        city: 'London',
        county: 'Greater London',
        country: 'United Kingdom',
        latitude: 51.5051,
        longitude: -0.0197,
        phone: '+44 20 3456 7890',
        hours: 'Mon-Fri 6AM-10PM, Sat-Sun 8AM-6PM',
        isPrimary: true,
        active: true,
      },
    }),
  ]);

  console.log(`✅ Created ${locations.length} locations`);

  // Create some verification records (wash history)
  const verifications = [];
  for (let i = 0; i < 15; i++) {
    const daysAgo = Math.floor(Math.random() * 30); // Random day in last 30 days
    const verification = await prisma.verification.create({
      data: {
        userId: [testUser1.id, testUser2.id, testUser3.id][i % 3],
        partnerId: [partner1.id, partner2.id, partner3.id][i % 3],
        subscriptionId: [subscription1.id, subscription2.id, subscription3.id][i % 3],
        locationId: locations[i % locations.length].id,
        verifiedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      },
    });
    verifications.push(verification);
  }

  console.log(`✅ Created ${verifications.length} verification records (wash history)`);

  console.log('\n🎉 Database seeded successfully!');
  console.log('\n📋 Test Accounts:');
  console.log('─────────────────────────────────────────────────');
  console.log('👤 ADMIN ACCOUNTS:');
  console.log('   Email: admin@bellawash.com');
  console.log('   Password: Admin123!');
  console.log('');
  console.log('   Email: superadmin@bellawash.com');
  console.log('   Password: SuperAdmin123!');
  console.log('─────────────────────────────────────────────────');
  console.log('👥 USER ACCOUNTS:');
  console.log('   Email: john@example.com | Password: User123!');
  console.log('   Email: jane@example.com | Password: User123!');
  console.log('   Email: mike@example.com | Password: User123!');
  console.log('─────────────────────────────────────────────────');
  console.log('🏢 PARTNER ACCOUNTS:');
  console.log('   Email: partner1@example.com | Password: SecurePass123!');
  console.log('   Email: partner2@example.com | Password: AnotherSecurePass456!');
  console.log('   Email: partner3@example.com | Password: YetAnotherPass789!');
  console.log('─────────────────────────────────────────────────');

  console.log('🎉 Database seeded successfully!');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Error seeding database:', e);
    await prisma.$disconnect();
    process.exit(1);
  });