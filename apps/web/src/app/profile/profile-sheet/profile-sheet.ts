import { Component, computed, input, output } from "@angular/core";
import type { InferResponseType } from "hono/client";
import type { api } from "../../lib/api";
import { UiText } from "../../ui/typography/text/text";
import { ProfileMark } from "../profile-mark/profile-mark";
import { ProfileRegion, type RegionRef } from "../profile-region/profile-region";

/**
 * The profile as the app's own surface (`US4`, `D17`, the mockup's right column).
 *
 * **Exhaustive.** Every post with every line and every project under it, every personal
 * project, every group with every entry, every diploma, the paper and the languages.
 * Nothing is folded, there is no "N more", and no list is virtualised: virtual
 * scrolling would fold the list, which is the one thing `US4` forbids. The mockup
 * renders 246 chips as plain spans and stays fluid.
 *
 * **Every figure it prints is a count of what it drew, or a document's own word.** The
 * headings count the rows below them; a year span is the first and last year the
 * documents themselves wrote; an item's source count is what the interface answered.
 * There is no other kind of number on this screen, and that is what criterion 9 is.
 *
 * It owns no state. The hover is CSS (`profile-region`), the selection goes out and up
 * because the thing that acts on it is `SL4`'s tool, and the answer arrives already
 * shaped: nothing here reshapes what the interface said.
 */

type Answer = InferResponseType<typeof api.intake.profile.$get, 200>;
type Item = Answer["experience"][number];

/** `1 post`, `8 posts`: the count, then the word, and never a bare plural on one. */
const say = (count: number, word: string, plural = `${word}s`): string =>
  `${count} ${count === 1 ? word : plural}`;

/** The years the documents themselves wrote, anywhere in an item's own dates. */
const yearsIn = (items: Item[]): number[] =>
  items
    .flatMap((item) => `${item.startText ?? ""} ${item.endText ?? ""}`.match(/\d{4}/g) ?? [])
    .map(Number);

@Component({
  selector: "profile-sheet",
  imports: [ProfileMark, ProfileRegion, UiText],
  templateUrl: "./profile-sheet.html",
})
export class ProfileSheet {
  public readonly profile = input.required<Answer>();

  /**
   * A tool is open: the sheet dims under the overlay and the selected region rises
   * above it (`ID125`, rules 1 and 2).
   */
  public readonly focused = input<boolean>(false);

  /** The one region that rises and is revealed, by its own id. */
  public readonly selected = input<string | null>(null);

  /** The region a person pressed. What opens on it is the viewer's. */
  public readonly select = output<RegionRef>();

  /**
   * A press on the overlay, which is a press on the sheet itself and never one that
   * landed on a region: the overlay is a pseudo-element and captures no pointer, so the
   * event's own target is what tells the two apart. It is the prefix's ×, and the
   * parent treats it as a skip (the mockup's handoff note).
   */
  public readonly overlayPressed = output<void>();

  /** Every project under a post, which is what the Experience panel's count is of. */
  protected readonly projectsUnderPosts = computed(() =>
    this.profile().experience.flatMap((post) =>
      post.children.filter((child) => child.kind === "project"),
    ),
  );

  /**
   * `8 posts, 2007 to 2026, 25 projects`. The span is the first and last year stated by
   * a document, read out of the dates as they were written; it is not a duration and
   * nothing is subtracted from anything.
   */
  protected readonly experienceLine = computed(() => {
    const posts = this.profile().experience;
    const years = yearsIn(posts);
    const span =
      years.length === 0
        ? []
        : [
            Math.min(...years) === Math.max(...years)
              ? `${Math.min(...years)}`
              : `${Math.min(...years)} to ${Math.max(...years)}`,
          ];
    return [
      say(posts.length, "post"),
      ...span,
      say(this.projectsUnderPosts().length, "project"),
    ].join(", ");
  });

  protected readonly groupsLine = computed(() => {
    const groups = this.profile().groups;
    const things = groups.reduce((count, group) => count + group.children.length, 0);
    return `${say(things, "thing")} in ${say(groups.length, "group")}, each one named in your documents`;
  });

  protected readonly diplomas = computed(() =>
    this.profile().education.filter((each) => each.kind === "education"),
  );

  protected readonly publications = computed(() =>
    this.profile().education.filter((each) => each.kind === "publication"),
  );

  protected readonly languages = computed(() =>
    this.profile().education.filter((each) => each.kind === "language"),
  );

  protected readonly educationLine = computed(() =>
    [
      say(this.diplomas().length, "diploma"),
      say(this.publications().length, "paper"),
      say(this.languages().length, "language"),
    ].join(", "),
  );

  /** How many documents an item came from, said the way the mockup says it. */
  protected from(count: number): string {
    return say(count, "document");
  }

  /** What a document stated about the dates, as it stated them. Never parsed. */
  protected dates(item: Item): string {
    if (item.project !== null) return item.project.datesText ?? "";
    return [item.startText, item.endText].filter((each) => each !== null).join(" – ");
  }

  /**
   * The line under a title: the organisation and where, the description of a project,
   * the institution of a diploma. Joined with the separator the mockup uses and
   * composed of nothing that is not in the answer.
   */
  protected detail(item: Item): string {
    const parts =
      item.experience !== null
        ? [
            item.experience.organisation,
            item.experience.organisationNote,
            item.experience.location,
            item.experience.arrangement,
          ]
        : item.education !== null
          ? [
              item.education.institution,
              item.education.location,
              item.education.credential,
              item.education.note,
            ]
          : item.project !== null
            ? [item.project.description]
            : [item.subtitle];
    return parts.filter((each) => each !== null && each !== "").join(" · ");
  }

  /** `10 projects`, the label above a post's projects. A count of the rows below it. */
  protected label(count: number, word: string): string {
    return say(count, word);
  }

  /** The projects hanging under a post, through `parent_id` and nothing else. */
  protected projectsOf(item: Item): Item[] {
    return item.children.filter((child) => child.kind === "project");
  }

  /** The chips on a project or a diploma: its `entry` children, and nothing else. */
  protected chipsOf(item: Item): Item[] {
    return item.children.filter((child) => child.kind === "entry");
  }

  protected chosen(region: RegionRef): void {
    this.select.emit(region);
  }

  /** Only a press on the sheet's own background is the overlay's; a region's is not. */
  protected pressed(event: Event): void {
    if (event.target !== event.currentTarget) return;
    this.overlayPressed.emit();
  }
}
