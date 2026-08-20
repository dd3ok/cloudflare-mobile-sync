import { pruneExpiredAccountDeletionReceipts } from "./account";
import type { Env } from "./env";
import { pruneExpiredNativeGoogleAuthAttempts } from "./native-google-auth";

/** Removes expired security capabilities independently of user traffic. */
export async function runScheduledMaintenance(
  env: Pick<Env, "DB">,
  scheduledTime: number,
): Promise<void> {
  await pruneExpiredNativeGoogleAuthAttempts(env.DB, scheduledTime);
  await pruneExpiredAccountDeletionReceipts(env.DB, scheduledTime);
}
