import { handle } from "../../server/app";
import type { Env } from "../../server/types";

export const onRequest = (ctx: { request: Request; env: Env }) => handle(ctx.request, ctx.env);
