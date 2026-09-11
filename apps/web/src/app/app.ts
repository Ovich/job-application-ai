import { Component } from "@angular/core";
import { RouterOutlet } from "@angular/router";

/** The shell: the routed screen and nothing else until there is a bar worth drawing. */
@Component({
  selector: "app-root",
  imports: [RouterOutlet],
  templateUrl: "./app.html",
})
export class AppRoot {}
