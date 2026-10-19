import type { ReflectionModelInput } from "./reflection-input-types.ts";

export interface ReflectionModelRequestOptions {
  maxInputBytes: number;
}

export class ReflectionModelContractError extends Error {
  constructor(readonly code: "input_too_large" | "invalid_reflection", message: string) {
    super(message);
    this.name = "ReflectionModelContractError";
  }
}

export interface ReflectionModelAdapter {
  readonly model_ref: string;
  readonly reflect: (input: ReflectionModelInput, options?: ReflectionModelRequestOptions) => Promise<unknown>;
}
