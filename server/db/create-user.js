import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import pool from './pool.js';

/**
 * Creates one real account on a server that has the schema but no data (`npm run db:migrate`).
 * It prints a random one-time passcode; the person must choose their own at first sign-in.
 *
 *   npm run db:create-user -- --epf EPF-100 --name "Full Name" --role MD \
 *       --title "Managing Director" --region "All Sri Lanka" --sector "All Sectors"
 *
 * A SECURITY_GUARD also needs  --site SITE-ID        (the post they are assigned to)
 * A CLIENT also needs          --sites SITE-ID,SITE-ID  (the sites they may see)
 */
const ROLES = ['MD', 'GM', 'AGM', 'SM', 'VO', 'NVO', 'CONTROL_ROOM', 'SECURITY_GUARD', 'CLIENT'];

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  if (!key.startsWith('--')) { console.error(`Unexpected argument: ${key}`); process.exit(1); }
  args[key.slice(2)] = process.argv[i + 1];
}

const fail = (message) => { console.error(message); process.exitCode = 1; };

// 12 characters, always with at least one letter and one number, without look-alike characters.
const makePasscode = () => {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [pick(letters), pick(digits), ...Array.from({ length: 10 }, () => pick(letters + digits))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
};

try {
  const { epf, name, role, title, region, sector } = args;
  if (!epf || !name || !role || !region || !sector) {
    fail('Required: --epf --name --role --region --sector (and --title is recommended)');
  } else if (!ROLES.includes(role)) {
    fail(`--role must be one of: ${ROLES.join(', ')}`);
  } else if (role === 'SECURITY_GUARD' && !args.site) {
    fail('A SECURITY_GUARD needs --site SITE-ID');
  } else if (role === 'CLIENT' && !args.sites) {
    fail('A CLIENT needs --sites SITE-ID,SITE-ID');
  } else if ((await pool.query('SELECT 1 FROM users WHERE epf = $1', [epf])).rows.length > 0) {
    fail(`${epf} already exists.`);
  } else {
    const passcode = makePasscode();
    const hash = await bcrypt.hash(passcode, await bcrypt.genSalt(10));
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(
        `INSERT INTO users (epf, name, role, title, region, sector, password_hash, must_change_password)
         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)`,
        [epf, name, role, title || role, region, sector, hash]
      );
      if (role === 'SECURITY_GUARD') {
        await db.query(`INSERT INTO security_guards (epf, name, rank, site_id) VALUES ($1, $2, 'Security Guard', $3)`, [epf, name, args.site]);
      }
      if (role === 'CLIENT') {
        for (const siteId of args.sites.split(',').map((s) => s.trim()).filter(Boolean)) {
          await db.query('INSERT INTO client_sites (client_epf, site_id) VALUES ($1, $2)', [epf, siteId]);
        }
      }
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
    console.log(`Created ${epf} (${role}).`);
    console.log(`One-time passcode: ${passcode}`);
    console.log('Give it to the person privately. They must choose their own at first sign-in.');
  }
} catch (error) {
  console.error('Could not create the account:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
