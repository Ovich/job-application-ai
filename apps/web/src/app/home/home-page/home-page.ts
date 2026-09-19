import { Component, computed, inject } from "@angular/core";
import { RouterLink } from "@angular/router";
import { CurrentUser } from "../../auth/current-user";
import { HlmBtn } from "../../ui/hlm-button";
import { UiBox } from "../../ui/layout/box/box";
import { UiRow } from "../../ui/layout/row/row";
import { UiStack } from "../../ui/layout/stack/stack";
import { UiTooltip } from "../../ui/tooltip/tooltip";
import { UiText } from "../../ui/typography/text/text";

/**
 * The index (D19): the page a signed-in person lands on at `/`, which until this slice
 * did not exist at all. One centred column of at most 600 px: who they are, the way to a
 * new offer, and their profile.
 *
 * It reads `CurrentUser` for the person and exposes signals; the template reaches no
 * service (`AGENTS.md` rule 3). It calls nothing else, and it asks the API nothing: what
 * the index says about a real application is `offer-intake`'s, and until that lands the
 * way onward is drawn and said to be unavailable rather than left out, so the screen is
 * honest about what it cannot do yet.
 */
@Component({
  selector: "home-page",
  imports: [RouterLink, HlmBtn, UiBox, UiRow, UiStack, UiText, UiTooltip],
  templateUrl: "./home-page.html",
})
export class HomePage {
  private readonly currentUser = inject(CurrentUser);

  protected readonly user = this.currentUser.person;

  /** What a greeting calls the person: the first word of their name, or nothing. */
  protected readonly firstName = computed(() => this.user()?.name.split(/\s+/)[0] ?? "");
}
