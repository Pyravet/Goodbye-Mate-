import { query } from '../db/pool.js';

export async function logAction({ actorUserId, action, targetType, targetId, metadata }) {
  await query(
    `INSERT INTO audit_log (actor_user_id, action, target_type, target_id, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [actorUserId || null, action, targetType || null, targetId || null, metadata ? JSON.stringify(metadata) : null]
  );
}
