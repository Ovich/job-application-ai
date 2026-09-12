import { Component, computed, inject, signal } from "@angular/core";
import { Router } from "@angular/router";
import type { InferResponseType } from "hono/client";
import { api } from "../../lib/api";
import { UiSpinner } from "../../ui/spinner/spinner";
import { UiText } from "../../ui/typography/text/text";
import { ProfileBar } from "../profile-bar/profile-bar";
import type { RegionRef } from "../profile-region/profile-region";
import { ProfileSheet } from "../profile-sheet/profile-sheet";

/**
 * The profile viewer (`D5`, `D6`, `ID123`): a route of its own, openable at any time,
 * with no done state and no exit.
 *
 * It is the CV builder's layout, deliberately — the assistant on the left, the document
 * on the right — so the person learns one workbench and the builder inherits a shell
 * already used against real content. **The left column is `SL4`'s** and is not drawn,
 * not stubbed and not styled here: what this slice draws is the right column and the
 * bar above it.
 *
 * The class reads the RPC client and hands the sheet a signal; the template reaches no
 * service (`AGENTS.md` 3). Types travel Drizzle to `AppType` to `InferResponseType` and
 * arrive here inferred — nothing about the answer is declared in this application, and
 * `@app/db` is never reached from the browser.
 *
 * The selection goes out of the sheet and stops here. What opens on a region is the
 * tool, and the tool is `SL4`'s.
 */

type Answer = InferResponseType<typeof api.intake.profile.$get, 200>;

@Component({
  selector: "profile-viewer",
  imports: [ProfileBar, ProfileSheet, UiSpinner, UiText],
  templateUrl: "./profile-viewer.html",
})
export class ProfileViewer {
  private readonly router = inject(Router);

  protected readonly profile = signal<Answer | null>(null);

  /** Which column is showing below 1024 px. The profile is what a person came for. */
  protected readonly view = signal<"sheet" | "chat">("sheet");

  /** The last region pressed. Nothing consumes it yet; the tool that will is `SL4`'s. */
  protected readonly selected = signal<RegionRef | null>(null);

  protected readonly state = computed<"loading" | "empty" | "loaded">(() => {
    const profile = this.profile();
    if (profile === null) return "loading";
    const anything =
      profile.summary !== null ||
      profile.identity !== null ||
      profile.experience.length +
        profile.projects.length +
        profile.groups.length +
        profile.education.length >
        0;
    return anything ? "loaded" : "empty";
  });

  /** `From 5 documents, read today`: a count of documents, and when they were read. */
  protected readonly readLine = computed(() => {
    const profile = this.profile();
    if (profile === null || profile.documents === 0) return "";
    const documents = `${profile.documents} document${profile.documents === 1 ? "" : "s"}`;
    return `From ${documents}, read ${this.when(profile.readOn)}`;
  });

  protected readonly name = computed(() => this.profile()?.name ?? "");

  /**
   * Which column is on the screen. Two from 1024 px; below it one at a time, and the
   * bar stays with the sheet's column so the toggle back is never off the screen.
   */
  protected readonly assistantClass = computed(() =>
    [
      "min-h-0 min-w-0 border-border bg-card max-lg:order-2 lg:block lg:border-r",
      this.view() === "chat" ? "block" : "hidden",
    ].join(" "),
  );

  protected readonly scrollClass = computed(() =>
    [
      "min-h-0 flex-1 flex-col items-center overflow-auto p-4 lg:p-7",
      this.view() === "chat" ? "hidden lg:flex" : "flex",
    ].join(" "),
  );

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const answer = await api.intake.profile.$get();
    if (answer.ok) this.profile.set(await answer.json());
  }

  /** `today`, or the day itself. Read from the answer; nothing is counted from it. */
  private when(readOn: string | null): string {
    if (readOn === null) return "today";
    const read = new Date(readOn);
    const today = new Date();
    return read.toDateString() === today.toDateString()
      ? "today"
      : `on ${read.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`;
  }

  protected toggleView(): void {
    this.view.update((view) => (view === "sheet" ? "chat" : "sheet"));
  }

  protected chosen(region: RegionRef): void {
    this.selected.set(region);
  }

  /** The way back to the drop zone, which is what an empty profile needs most. */
  protected addDocuments(): Promise<boolean> {
    return this.router.navigateByUrl("/documents");
  }
}
