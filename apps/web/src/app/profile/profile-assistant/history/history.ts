import { HistoryAboutPart } from "./history-about-part/history-about-part";
import { HistoryAnswerPart } from "./history-answer-part/history-answer-part";
import { HistoryEditPart } from "./history-edit-part/history-edit-part";
import { HistorySkipPart } from "./history-skip-part/history-skip-part";

/**
 * The profile assistant's history parts (D3): what its `#part` template draws each stored
 * part that is not text with. Referenced by `ProfileAssistant` alone.
 */
export const profileAssistantHistory = [
  HistoryEditPart,
  HistoryAnswerPart,
  HistorySkipPart,
  HistoryAboutPart,
] as const;
