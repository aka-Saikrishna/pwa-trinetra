const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Verifying setup...');
  
  // Check Predefined Issues
  const count = await prisma.predefinedIssue.count();
  console.log(`Predefined Issues Count: ${count}`);
  
  if (count === 0) {
      console.log('WARNING: No predefined issues found. You might want to run seed-issues-v4.js');
  }

  // Check Users
  const users = await prisma.user.findMany();
  console.log(`Users Count: ${users.length}`);
  users.forEach(u => console.log(` - ${u.name} (${u.role}) | Email: ${u.email} | Pass: ${u.password}`));

  await prisma.$disconnect();
}

main().catch(console.error);
