import type { GenerationStatus } from './generation';

export type GenerationStopResult = {
  generation_id: string;
  status: GenerationStatus;
  stop_requested: boolean;
};
