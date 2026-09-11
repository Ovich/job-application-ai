import { Component } from "@angular/core";
import { RouterOutlet } from "@angular/router";

/** The layout above the signed-in routes (ID75). The bar arrives with seam E. */
@Component({
  selector: "app-shell",
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class AppShell {}
