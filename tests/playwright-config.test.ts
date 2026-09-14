import { describe, expect, it } from "vitest";
import config from "../playwright.config";

/**
 * agent-consolidation `SL9` (`S9.5`, `ID231`): a run against dev records nothing. A trace
 * carries the signed session cookie and every request's body, a video and a screenshot
 * what the person's screens showed, so the `deployed` project turns all three off by name
 * rather than trusting a default.
 */
describe("the deployed Playwright project", () => {
  const deployed = config.projects?.find((project) => project.name === "deployed");

  it("sets trace, video and screenshot to off explicitly", () => {
    expect(deployed?.use).toMatchObject({ trace: "off", video: "off", screenshot: "off" });
  });
});
