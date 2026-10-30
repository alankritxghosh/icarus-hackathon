import { handleEdit, handlePropose, handleRevise, modelFromEnv } from "./design";
import { handleDrawingViews } from "./drawing";
import { handleReadPhoto } from "./photo";
import { type Env, handleRender } from "./render";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/render") return handleRender(request, env);
    if (pathname === "/api/drawing/views") return handleDrawingViews(request, env);
    if (pathname === "/api/read-photo") return handleReadPhoto(request, env);
    if (pathname === "/api/design/propose")
      return handlePropose(request, modelFromEnv(env as never));
    if (pathname === "/api/design/revise") return handleRevise(request, modelFromEnv(env as never));
    if (pathname === "/api/design/edit") return handleEdit(request, modelFromEnv(env as never));
    return new Response("not found", { status: 404 });
  },
};
