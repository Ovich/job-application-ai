-- A conversation gains a system author (D34, ID303): what changed outside the conversation,
-- pushed into its history as a notice. An enum value added, nothing else moves.
ALTER TYPE "public"."conversation_author" ADD VALUE 'system';
