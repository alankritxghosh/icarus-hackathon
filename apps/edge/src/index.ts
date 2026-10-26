import { handleReadPhoto } from "./photo";
import { type Env, handleRender } from "./render";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/render") return handleRender(request, env);
    if (pathname === "/api/read-photo") return handleReadPhoto(request, env);
    return new Response("not found", { status: 404 });
  },
};
