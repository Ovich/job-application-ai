# ModelMock

A model that answers what you wrote for it, on the wire a provider answers on: OpenAI chat
completions and Anthropic messages, whole or streamed, tool calls included, paced the way a
model is. It holds no client and opens no connection: a request it has no answer for is a miss,
never a call.

Web-standard `Request`, `Response` and streams only. No framework, no environment, no router.

## The integration

```ts
import { ModelMock } from "./mock";

const model = new ModelMock("./answers");
```

Then hand a request to it, whichever way the host does that:

```ts
// a router: the paths are yours
app.post("/v1/chat/completions", (c) => model.chatCompletions(c.req.raw));
app.post("/v1/messages", (c) => model.messages(c.req.raw));

// a route file whose export is the handler
export const POST = model.chatCompletions;

// standalone: dispatches on the path's end, /chat/completions or /messages, 404 otherwise
Bun.serve({ fetch: model.fetch });

// in process, no port: the client's own option
new OpenAI({
  baseURL: "http://mock.test/v1",
  apiKey: "unused",
  fetch: (input, init) => model.fetch(new Request(input, init)),
});
```

## An answer

One JSON file per answer, anywhere under the folder; subfolders are your own organisation.
`content` is required unless the answer has `tool_calls`, and keys the mock does not know
(`stands_for`, `note`, `$schema`) are ignored.

```json
{
  "answers": "What is the capital of Vaud?",
  "content": "Lausanne.",
  "tool_calls": [{ "name": "look_up", "arguments": { "canton": "VD" } }],
  "usage": { "input_tokens": 12, "output_tokens": 2 }
}
```

| key          | what it is                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `content`    | the text the model says                                                                        |
| `answers`    | the exact last `user` message this replies to: the whole string, untrimmed, no partial match   |
| `case`       | an exact name a request may ask for in the case header                                         |
| `tool_calls` | the calls, `{ name, arguments, id? }`; `arguments` an object, or a string sent verbatim        |
| `usage`      | `{ input_tokens, output_tokens }`, mapped to each protocol's own names; zero when left out     |
| `next`       | the answer to the next request, once these calls were made: an answer without `answers`/`case` |

A request is answered by the `case` its header names, else by the answer whose `answers` equals
its last user message, else by the placeholder `No pre generated text` with one warning line.
Files are read on every request, so an edited file is the next answer. A file that is not JSON,
has no `content` and no `tool_calls`, or has a `next` but no `tool_calls` throws naming the file;
two answers with the same `case` or the same `answers` throw naming both.

An answer's id is its `case`, else its path without the extension (`profile/greeting`); inline,
its `case` or its index.

### A chain

An answer with `next` is a chain: the call is answered, the caller runs the tool, and the next
request, which carries the call and its result after the same user message, gets the `next`.

```json
{
  "answers": "What is the capital of Vaud?",
  "tool_calls": [{ "name": "look_up", "arguments": { "canton": "VD" } }],
  "next": { "content": "Lausanne." }
}
```

The mock walks one `next` per assistant message with calls since the last user message, and
checks each against the calls written at its link, by name and by arguments deep-equal. A call
that differs, or a chain that has run out, is a miss. An answer without `next` is answered
whatever came after the user message.

## The options

```ts
new ModelMock(folderOrAnswers, {
  pace: "tps=40;ttft=400;chunk=3;jitter=0.15", // or { tokensPerSecond, … }, or "instant"
  stream: "as-asked", // or "always", "never"
  caseHeader: "x-mock-case",
  paceHeader: "x-mock-pace",
  onMiss: "placeholder", // or "error": a 404 JSON
});
```

The pace is four settings: tokens per second (`tps`), time to first token in milliseconds
(`ttft`), tokens per chunk (`chunk`) and `jitter`, a fraction of the interval. A request may ask
for its own in the pace header, in the same spelling; what it leaves unsaid stays as configured.
Whatever the pace, the pieces joined equal the answer's content.

## In a test

```ts
const model = new ModelMock([], { pace: "instant" });

model.use({ answers: "Hello", content: "Hi." }); // tried before the constructor's answers
// … drive the code under test with model.fetch …
model.requests; // [{ protocol, headers, body, lastUserMessage, picked }]
model.reset(); // back to the constructor's answers, the log emptied
```
