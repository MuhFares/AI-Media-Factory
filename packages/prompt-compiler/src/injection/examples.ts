/**
 * Examples Injection (Req #12).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Injects few-shot examples from the agent's examples.md into the prompt.
 */

export interface ExamplesInjector {
  /** Inject few-shot examples into the prompt. */
  inject(examples: ExampleSet, options?: ExamplesInjectionOptions): Promise<string>;
}

export interface Example {
  input: string;
  output: string;
  description?: string;
}

export interface ExampleSet {
  examples: Example[];
  /** Description of what the examples demonstrate. */
  description?: string;
}

export interface ExamplesInjectionOptions {
  maxExamples?: number;
  maxTokens?: number;
  format?: "input_output" | "input_output_reasoning" | "compact";
  /** Shuffle examples? */
  shuffle?: boolean;
}

export interface ExamplesInjectionResult {
  content: string;
  examplesIncluded: number;
  tokens: number;
  truncated: boolean;
}