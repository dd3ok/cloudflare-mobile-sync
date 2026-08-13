import { createApp } from "./app";
import type { Env } from "./env";
import { runScheduledMaintenance } from "./scheduled-maintenance";

export { createApp } from "./app";

const app = createApp();

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
  async scheduled(controller, env) {
    await runScheduledMaintenance(env, controller.scheduledTime);
  },
} satisfies ExportedHandler<Env>;
