import { type Env, handleRender } from "./render";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/render") return handleRender(request, env);
    return new Response("not found", { status: 404 });
  },
};
