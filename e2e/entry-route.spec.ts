import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/**
 * The indexable door (US6, ID63): the entry route as a crawler receives it, with no
 * JavaScript at all. Seam D of SL3, the prerender (ID77).
 *
 * Two readings of the same HTML. The dev server's, opened with JavaScript disabled, is
 * what a laptop can serve; the built file's is what the deployment syncs to the bucket,
 * where the title, the description and the canonical link are what a search engine
 * reads. The head's values are the entry route's own (it sets them where it renders),
 * so what is proved here is that the build wrote them out, not what they say.
 *
 * The built file is `pnpm --filter @app/web build`'s, read from where the application
 * builder writes it. A test that finds no build says so rather than skipping: a green
 * run that never read the file would prove nothing about the prerender.
 */

const builtEntryRoute = fileURLToPath(
  new URL("../apps/web/dist/web/browser/index.html", import.meta.url),
);

const heading = "Your job application in the era of AI";
const sentence = "A tailored CV and cover letter for every job offer. Let the silence stop.";
const title = "AI CV builder for every job offer | job-application.app";
const description =
  "Your job application in the era of AI. A tailored CV and cover letter for every job offer. Let the silence stop. Built from one profile made of the CVs you already have.";
const canonical = "https://job-application.app/";

test.describe("the entry route with JavaScript disabled", () => {
  test.use({ javaScriptEnabled: false });

  test("serves the heading in the HTML of /", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("h1")).toHaveText(heading);
    await expect(page.getByText(sentence)).toBeVisible();
    await expect(page).toHaveTitle(title);
  });
});

test.describe("the built HTML of /", () => {
  test("carries the title, the description, the canonical link, the h1 and the sentence", async () => {
    const html = await readFile(builtEntryRoute, "utf8").catch(() => {
      throw new Error(
        `no built entry route at ${builtEntryRoute}: run pnpm --filter @app/web build first`,
      );
    });

    expect(html).toContain(`<title>${title}</title>`);
    expect(html).toMatch(
      new RegExp(`<meta name="description" content="${description.replace(/\./g, "\\.")}"`),
    );
    expect(html).toContain(`<link rel="canonical" href="${canonical}">`);
    expect(html).toMatch(new RegExp(`<h1[^>]*>\\s*${heading}\\s*</h1>`));
    expect(html).toContain(sentence);
  });
});
