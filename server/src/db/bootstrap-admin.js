// Creates or resets a specific admin account from environment variables,
// on every deploy. This exists so Claude (or anyone without direct
// database/console access) can reliably fix or create an admin login by
// setting Railway variables, rather than needing someone to type commands
// into the Railway console by hand.
//
// No-ops entirely if the env vars aren't set, so it's safe to leave this
// wired into the pre-deploy step permanently — it only ever does anything
// when ADMIN_BOOTSTRAP_EMAIL is actually present.
import bcrypt from 'bcryptjs';
import { pool, query } from './pool.js';

async function main() {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  const fullName = process.env.ADMIN_BOOTSTRAP_NAME || 'Admin';

  if (!email || !password) {
    console.log('ADMIN_BOOTSTRAP_EMAIL/PASSWORD not set — skipping admin bootstrap.');
    await pool.end();
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await query(
    `INSERT INTO users (email, password_hash, role, full_name, is_active)
     VALUES ($1, $2, 'admin', $3, true)
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       role = 'admin',
       full_name = EXCLUDED.full_name,
       is_active = true`,
    [email.toLowerCase(), passwordHash, fullName]
  );

  console.log(`Admin bootstrap: ${email} is ready.`);
  await pool.end();
}

main().catch((err) => {
  console.error('Admin bootstrap failed:', err);
  process.exit(1);
});
