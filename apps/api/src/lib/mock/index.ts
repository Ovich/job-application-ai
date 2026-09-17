/**
 * The mock's only entry (`ID295`): the class and its four types, nothing else.
 *
 * A file that binds it learns nothing about the answer files, the loader, the two
 * serialisers, the chunking or the pacing clock, and nothing about a router, because there
 * is none. Nothing under this folder imports from an application, reads the environment or
 * imports a framework: a header name, a pace or a folder is an option the binding passes.
 */
export type { Answer } from "./answers";
export { type Answered, ModelMock, type ModelMockOptions } from "./model-mock";
export type { Pace } from "./pace";
