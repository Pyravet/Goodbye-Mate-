// Creates (or resets the password of) the first admin user.
// Usage: node src/db/seed-admin.js "admin@goodbyemate.com.au" "TempPassword123!" "Admin Name"
import bcrypt from 'bcryptjs';
import { pool, query } from './pool.js';

const [, , email, password, fullName] = process.argv;

if (!email || !password || !fullName) {
  console.error('Usage: node src/db/seed-admin.js <email> <password> "<full name>"');
  process.exit(1);
}

async function main() {
  const passwordHash = await bcrypt.hash(password, 12);

  await query(
    `INSERT INTO users (email, password_hash, role, full_name)
     VALUES ($1, $2, 'admin', $3)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [email.toLowerCase(), passwordHash, fullName]
  );

  console.log(`Admin user ready: ${email}`);
  console.log('Log in, then change this password from a real admin session.');
  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
