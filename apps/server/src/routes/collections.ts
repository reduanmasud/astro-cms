import { Hono } from "hono";
import type { AuthEnv } from "../http/authenticate.ts";
import { apiError } from "../http/errors.ts";
import type { AstroProjectService } from "../services/astro-project.ts";

/** `/api/collections`: content collections discovered from the Astro project. */
export function collectionRoutes(project: AstroProjectService): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();

  routes.get("/", async (c) => c.json(await project.discover()));

  routes.get("/:collection", async (c) => {
    const detail = await project.getCollection(c.req.param("collection"));
    return detail
      ? c.json(detail)
      : apiError(
          c,
          404,
          "collection_not_found",
          "No collection with that name.",
        );
  });

  return routes;
}
