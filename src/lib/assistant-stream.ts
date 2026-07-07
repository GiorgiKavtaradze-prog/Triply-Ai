export const ASSISTANT_META_SEPARATOR = "\u001e";

export type AssistantStreamMeta = {
  model: string | null;
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cached_tokens?: number;
    reasoning_tokens?: number;
  } | null;
};