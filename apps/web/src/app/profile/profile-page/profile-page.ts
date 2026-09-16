import { Component, computed, signal } from "@angular/core";
import {
  type Pressed,
  ProfileAssistant,
  type Question,
} from "../profile-assistant/profile-assistant";
import { ProfileViewer } from "../profile-viewer/profile-viewer";

/**
 * The profile page (D2, D8): the route, the two-column layout and the view toggle.
 *
 * It is the CV builder's layout, deliberately — the assistant on the left, the document on
 * the right — so the person learns one workbench and the builder inherits a shell already
 * used against real content.
 *
 * **It holds no behaviour of either section and nothing of the assistant.** What the right
 * section says goes to the left one, and what the left one does goes back, by template:
 * `ProfileViewer` owns the profile, the selection and the click-away, and `ProfileAssistant`
 * the conversation (D1).
 */
@Component({
  selector: "profile-page",
  imports: [ProfileAssistant, ProfileViewer],
  templateUrl: "./profile-page.html",
  // The layout every assistant screen holds to (the person, 2026-09-12): this fills the
  // page rather than growing past it, so the window never scrolls and each column
  // decides for itself what moves inside it.
  host: { class: "flex min-h-0 flex-1 flex-col" },
})
export class ProfilePage {
  /** Which column is showing below 1024 px. The profile is what a person came for. */
  protected readonly view = signal<"sheet" | "chat">("sheet");

  /** Relayed from the right section to the left. */
  protected readonly questions = signal<Question[]>([]);

  protected readonly pressed = signal<Pressed | null>(null);

  protected readonly dismissed = signal(false);

  /** Whether a reading has made a profile, which is when the assistant exists (`ID202`). */
  protected readonly read = signal(false);

  protected readonly returning = signal(false);

  protected readonly reading = signal<{ documents: number; facts: number }>({
    documents: 0,
    facts: 0,
  });

  /** Relayed from the left section to the right. */
  protected readonly activated = signal<{ itemId: string } | null>(null);

  /** How many times the person's own tool was put away: each one is news to the viewer. */
  protected readonly closed = signal(0);

  protected readonly decided = signal<{ kept: boolean } | null>(null);

  /** Two columns once there is an assistant; the sheet alone before. */
  protected readonly gridClass = computed(() =>
    [
      "-mt-10 grid h-full min-h-0 flex-1 overflow-hidden",
      this.read() ? "lg:grid-cols-[minmax(440px,42%)_minmax(0,1fr)]" : "",
    ].join(" "),
  );

  /**
   * Which column is on the screen. Two from 1024 px; below it one at a time, and the
   * bar stays with the sheet's column so the toggle back is never off the screen.
   */
  protected readonly assistantClass = computed(() =>
    [
      "flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-border bg-card max-lg:order-2 lg:flex lg:border-r",
      this.view() === "chat" ? "flex" : "hidden",
    ].join(" "),
  );

  protected toggleView(): void {
    this.view.update((view) => (view === "sheet" ? "chat" : "sheet"));
  }
}
