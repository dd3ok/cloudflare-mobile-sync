import { pruneExpiredAccountDeletionReceipts } from "./account";
import type { Env } from "./env";
import { pruneExpiredMobileAuthHandoffs } from "./mobile-auth-handoff";

/** Removes expired security capabilities independently of user traffic. */
export async function runScheduledMaintenance(
  env: Pick<Env, "DB">,
  scheduledTime: number,
): Promise<void> {
  await pruneExpiredMobileAuthHandoffs(env.DB, scheduledTime);
  await pruneExpiredAccountDeletionReceipts(env.DB, scheduledTime);
}
