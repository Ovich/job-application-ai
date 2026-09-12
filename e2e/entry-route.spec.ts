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
/** Under 155 characters, the length a result page shows whole; the h1 is not repeated in it. */
const description =
  "A tailored CV and cover letter for every job offer, built from one profile made of the CVs you already have. Let the silence stop.";
const canonical = "https://job-application.app/";

/**
 * What a link to `/` unfurls as when pasted into LinkedIn, Slack or a chat: the Open
 * Graph tags every unfurler reads, and the one Twitter card tag X does not take from
 * them. No `og:image` yet: a tag naming an image that is not there is cached as a
 * failure by some unfurlers, so the tag waits for the image.
 */
const unfurl = {
  "og:type": "website",
  "og:site_name": "job-application.app",
  "og:title": heading,
  "og:description": description,
  "og:url": canonical,
};
const twitterCard = "summary";

test.describe("the entry route with JavaScript disabled", () => {
  test.use({ javaScriptEnabled: false });

  /**
   * Both projects ask this, and deployed it is criterion 12: what a crawler receives
   * from the address people will use, served as an object out of the bucket rather than
   * rendered by a dev server. The head is read from the document itself, because a
   * crawler with no JavaScript reads exactly that.
   */
  test("serves the heading, the title, the description and the canonical link in the HTML of /", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.locator("h1")).toHaveText(heading);
    await expect(page.getByText(sentence)).toBeVisible();
    await expect(page).toHaveTitle(title);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", description);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", canonical);
    for (const [property, content] of Object.entries(unfurl)) {
      await expect(page.locator(`meta[property="${property}"]`)).toHaveAttribute(
        "content",
        content,
      );
    }
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", twitterCard);
  });
});

test.describe("the built HTML of /", () => {
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the fixtures a test asks for off its destructuring pattern, so the argument has to be destructured even when it needs none of them.
  test("carries the title, the description, the canonical link, the h1 and the sentence", async ({}, testInfo) => {
    test.skip(
      testInfo.project.name === "deployed",
      "the built file is what a deploy syncs; what the deployed address serves is read above, over HTTP",
    );
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
    for (const [property, content] of Object.entries(unfurl)) {
      expect(html).toContain(`<meta property="${property}" content="${content}">`);
    }
    expect(html).toContain(`<meta name="twitter:card" content="${twitterCard}">`);
    expect(html).toMatch(new RegExp(`<h1[^>]*>\\s*${heading}\\s*</h1>`));
    expect(html).toContain(sentence);
  });
});
