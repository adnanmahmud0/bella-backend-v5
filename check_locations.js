
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const locations = await prisma.location.findMany({
      include: {
        partner: {
          select: {
            name: true,
            status: true
          }
        }
      }
    });

    console.log('Total locations:', locations.length);
    locations.forEach(loc => {
      console.log(`- ID: ${loc.id}, Name: ${loc.name}, Lat: ${loc.latitude}, Lng: ${loc.longitude}, Active: ${loc.active}, Partner: ${loc.partner.name} (${loc.partner.status})`);
    });

  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
